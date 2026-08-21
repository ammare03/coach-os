// `./env.ts` parses `process.env` the moment it is imported and calls
// `process.exit(1)` if a required variable is missing — correct for a real
// boot, fatal for a test file that just wants to import `app`. This runs
// before any test module loads (Jest `setupFiles`, not `setupFilesAfterEnv`)
// and fills in every required variable with an obviously-fake value.
//
// These are not secrets — no real credential is reachable through them —
// so committing them is fine; `.env.test` would not be (`.gitignore` allows
// only `.env.example`), which is why this lives in a plain .ts file instead.
process.env.NODE_ENV = 'test';
// Never actually bound — `server` is guarded off under NODE_ENV=test
// (src/index.ts) — but PORT is `positive()`, so it still needs a value
// that satisfies the schema.
process.env.PORT = '3000';

process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/coachos_test';
process.env.REDIS_URL = 'redis://localhost:6379/1';

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-token-secret';

process.env.R2_ACCOUNT_ID = 'test-r2-account-id';
process.env.R2_ACCESS_KEY_ID = 'test-r2-access-key-id';
process.env.R2_SECRET_ACCESS_KEY = 'test-r2-secret-access-key';
process.env.R2_BUCKET_NAME = 'coachos-media-test';

process.env.LIVEKIT_API_KEY = 'test-livekit-api-key';
process.env.LIVEKIT_API_SECRET = 'test-livekit-api-secret';

process.env.REVENUECAT_SECRET_API_KEY = 'test-revenuecat-secret-api-key';
process.env.REVENUECAT_WEBHOOK_AUTH_HEADER = 'test-revenuecat-webhook-auth-header';

process.env.STRIPE_SECRET_KEY = 'sk_test_test-stripe-secret-key';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test-stripe-webhook-secret';

process.env.RESEND_API_KEY = 'test-resend-api-key';

process.env.ANTHROPIC_API_KEY = 'test-anthropic-api-key';

process.env.OPEN_FOOD_FACTS_USER_AGENT = 'CoachOS/1.0 (test)';

process.env.SENTRY_AUTH_TOKEN = 'test-sentry-auth-token';
