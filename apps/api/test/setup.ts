// Isolated test database + storage; must run before any app module reads config.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://vitalog:vitalog_dev_only@127.0.0.1:5433/vitalog_test';
process.env.STORAGE_LOCAL_DIR = '../../storage/test-files';
process.env.OCR_PROVIDER = 'none';
process.env.AI_PROVIDER = 'none';
process.env.EMAIL_PROVIDER = 'console';
process.env.APP_ORIGIN = 'http://localhost:5173';
