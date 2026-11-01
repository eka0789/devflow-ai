// Runs before any test module imports app code: pin deterministic env.
process.env.APP_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
process.env.DB_PATH = ':memory:';
delete process.env.AI_BASE_URL;
delete process.env.AI_API_KEY;
delete process.env.AI_MODEL;
delete process.env.GITHUB_WEBHOOK_SECRET;
process.env.LOG_LEVEL = 'error';
