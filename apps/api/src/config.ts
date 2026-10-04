import { z } from 'zod';

/** All configuration comes from environment variables (see /.env.example). Secrets never have defaults in production. */
const bool = (def: 'true' | 'false') => z.enum(['true', 'false', '1', '0']).default(def).transform((v) => v === 'true' || v === '1');
const isProd = process.env.NODE_ENV === 'production';
const devOnly = (v: string) => (isProd ? undefined : v);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('127.0.0.1'),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().default(devOnly('postgres://vitalog:vitalog_dev_only@127.0.0.1:5433/vitalog') as string),
  /** 32-byte base64 master key that wraps per-user data keys. Use a KMS in production. */
  ENCRYPTION_KEK: z.string().min(40).default(devOnly('ZGV2LW9ubHkta2V5LWRvLW5vdC11c2UtaW4tcHJvZCE=') as string),
  /** HMAC key for signed download URLs and share tokens. */
  URL_SIGNING_SECRET: z.string().min(32).default(devOnly('dev-only-url-signing-secret-change-me-please') as string),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('../../storage/files'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  OCR_PROVIDER: z.enum(['tesseract', 'none']).default('tesseract'),
  TESSERACT_LANG_PATH: z.string().optional(),
  TESSERACT_CACHE_DIR: z.string().default('../../storage/tessdata'),
  AI_PROVIDER: z.enum(['none', 'mock', 'openai', 'anthropic']).default('none'),
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  AI_MODEL: z.string().default('gpt-4.1-mini'),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(50).default(15),
  MAX_PDF_PAGES: z.coerce.number().min(1).max(200).default(30),
  MONTHLY_PROCESSING_LIMIT: z.coerce.number().default(50),
  MONTHLY_AI_LIMIT: z.coerce.number().default(30),
  REQUIRE_EMAIL_VERIFICATION: bool(isProd ? 'true' : 'false'),
  SESSION_IDLE_MINUTES: z.coerce.number().default(30),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().default(12),
  DEMO_MODE_ENABLED: bool('true'),
  DEMO_TTL_HOURS: z.coerce.number().default(24),
  DEMO_RATE_LIMIT_PER_HOUR: z.coerce.number().default(isProd ? 5 : 200),
  AUDIT_RETENTION_DAYS: z.coerce.number().default(365),
  EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default('Vitalog <no-reply@vitalog.example>'),
  TRUST_PROXY: bool('false'),
  LOG_LEVEL: z.string().default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid configuration:', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  process.exit(1);
}
export const config = parsed.data;
export const IS_PROD = config.NODE_ENV === 'production';
if (IS_PROD && config.AI_PROVIDER === 'mock') throw new Error('AI_PROVIDER=mock is not allowed in production');
