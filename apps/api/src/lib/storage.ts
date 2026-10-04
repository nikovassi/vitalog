import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';

/**
 * Private object storage. Objects are already encrypted by the caller (lib/files.ts), so
 * the storage provider never sees plaintext. Keys are server-generated UUID paths.
 */
export interface StorageProvider {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
}

const SAFE_KEY = /^[a-zA-Z0-9/_-]+$/;
function assertKey(key: string) {
  if (!SAFE_KEY.test(key) || key.includes('..')) throw new Error('Invalid storage key');
}

export class LocalEncryptedStorage implements StorageProvider {
  constructor(private root: string) {}
  private p(key: string) {
    assertKey(key);
    return path.join(this.root, key);
  }
  async put(key: string, data: Buffer) {
    const file = this.p(key);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, data, { mode: 0o600 });
  }
  get(key: string) {
    return readFile(this.p(key));
  }
  async delete(key: string) {
    await rm(this.p(key), { force: true });
  }
  async deletePrefix(prefix: string) {
    await rm(this.p(prefix), { recursive: true, force: true });
  }
}

/**
 * S3-compatible storage (Scaleway / OVHcloud / AWS eu-central-1 / Cloudflare R2 EU).
 * The bucket must be private (block public access) with server-side encryption on.
 * Implemented with @aws-sdk/client-s3, loaded lazily so local dev needs no AWS deps.
 */
export class S3Storage implements StorageProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: Promise<{ s3: any; mod: any }>;
  constructor(private bucket: string) {
    const pkg = '@aws-sdk/client-s3';
    this.client = import(/* @vite-ignore */ pkg).then((mod) => ({
      mod,
      s3: new mod.S3Client({
        region: config.S3_REGION,
        endpoint: config.S3_ENDPOINT,
        credentials: { accessKeyId: config.S3_ACCESS_KEY_ID!, secretAccessKey: config.S3_SECRET_ACCESS_KEY! },
        forcePathStyle: true,
      }),
    }));
  }
  async put(key: string, data: Buffer) {
    assertKey(key);
    const { s3, mod } = await this.client;
    await s3.send(new mod.PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: 'application/octet-stream' }));
  }
  async get(key: string) {
    assertKey(key);
    const { s3, mod } = await this.client;
    const out = await s3.send(new mod.GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await out.Body.transformToByteArray());
  }
  async delete(key: string) {
    assertKey(key);
    const { s3, mod } = await this.client;
    await s3.send(new mod.DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  async deletePrefix(prefix: string) {
    assertKey(prefix);
    const { s3, mod } = await this.client;
    let token: string | undefined;
    do {
      const list = await s3.send(new mod.ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      const keys = (list.Contents ?? []).map((o: { Key: string }) => ({ Key: o.Key }));
      if (keys.length) await s3.send(new mod.DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys } }));
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);
  }
}

export const storage: StorageProvider =
  config.STORAGE_DRIVER === 's3'
    ? new S3Storage(config.S3_BUCKET!)
    : new LocalEncryptedStorage(path.resolve(process.cwd(), config.STORAGE_LOCAL_DIR));
