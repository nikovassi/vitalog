import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { and, eq, sql } from 'drizzle-orm';
import type { DocumentCategory } from '@vitalog/shared';
import { config } from '../config';
import { db } from '../db/client';
import { documents, labReports, usageCounters } from '../db/schema';
import { sha256 } from '../lib/crypto';
import { putUserFile } from '../lib/files';
import { HttpError } from '../lib/http';
import type { SessionUser } from '../lib/auth';

export const period = () => new Date().toISOString().slice(0, 7);

/** OWASP: keep a safe display name only; storage keys are UUIDs. */
export function sanitizeFileName(raw: string): string {
  const base = path.basename(raw.replace(/\\/g, '/'))
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  const name = base || 'document';
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

export async function assertPdf(buf: Buffer) {
  const isPdfMagic = buf.subarray(0, 5).toString('latin1') === '%PDF-';
  const ft = await fileTypeFromBuffer(buf);
  if (!isPdfMagic || ft?.mime !== 'application/pdf') {
    throw new HttpError(415, 'not_pdf', 'Файлът не е валиден PDF. Поддържат се само PDF документи.');
  }
}

export async function checkQuota(userId: string) {
  const [row] = await db.select().from(usageCounters).where(and(eq(usageCounters.userId, userId), eq(usageCounters.period, period())));
  if ((row?.documentsProcessed ?? 0) >= config.MONTHLY_PROCESSING_LIMIT) {
    throw new HttpError(429, 'quota', `Достигна месечния лимит от ${config.MONTHLY_PROCESSING_LIMIT} обработени документа. Лимитът се подновява в началото на месеца.`);
  }
}

export async function bumpUsage(userId: string, field: 'documentsProcessed' | 'aiCalls', bytes = 0) {
  const col = field === 'documentsProcessed' ? usageCounters.documentsProcessed : usageCounters.aiCalls;
  await db.insert(usageCounters).values({ userId, period: period(), [field]: 1, bytesUploaded: bytes })
    .onConflictDoUpdate({ target: [usageCounters.userId, usageCounters.period], set: { [field]: sql`${col} + 1`, bytesUploaded: sql`${usageCounters.bytesUploaded} + ${bytes}` } });
}

/** Validate, de-duplicate, encrypt and store an uploaded PDF. */
export async function storeUpload(user: SessionUser, buf: Buffer, rawName: string, category: DocumentCategory, documentDate: string | null = null) {
  await assertPdf(buf);
  const hash = sha256(buf);
  const [dup] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.userId, user.id), eq(documents.sha256, hash)));
  if (dup) {
    const [rep] = await db.select({ id: labReports.id }).from(labReports).where(and(eq(labReports.userId, user.id), eq(labReports.documentId, dup.id)));
    throw new HttpError(409, 'duplicate', 'Този файл вече е качен.', { documentId: dup.id, reportId: rep?.id ?? null });
  }
  const storageKey = await putUserFile(user.id, user.dekEnc, buf);
  const [doc] = await db.insert(documents).values({
    userId: user.id, name: sanitizeFileName(rawName), category, documentDate, mimeType: 'application/pdf', sizeBytes: buf.length, sha256: hash, storageKey, source: 'upload',
  }).returning();
  return doc!;
}
