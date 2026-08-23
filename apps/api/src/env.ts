import { z } from 'zod';

// The single place server environment is read. Nothing else in the API calls
// process.env directly. Parsed once at module load; a missing or invalid
// required variable fails startup immediately with the variable's name, not
// three requests later inside a database driver. See the `configuration`
// skill and CLAUDE.md §16.1 — every variable here is server-only and MUST
// NEVER be prefixed EXPO_PUBLIC_.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  JWT_SECRET: z.string().min(1),
  REFRESH_TOKEN_SECRET: z.string().min(1),

  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),

  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),

  REVENUECAT_SECRET_API_KEY: z.string().min(1),
  REVENUECAT_WEBHOOK_AUTH_HEADER: z.string().min(1),

  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),

  RESEND_API_KEY: z.string().min(1),

  ANTHROPIC_API_KEY: z.string().min(1),

  OPEN_FOOD_FACTS_USER_AGENT: z.string().min(1),

  SENTRY_AUTH_TOKEN: z.string().min(1),
});

function loadEnv(): z.infer<typeof envSchema> {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    // No logger exists yet — this runs before anything else in the process,
    // and a server that can't read its own config can't log through a
    // normal pipeline either.
    console.error(`API failed to start — missing or invalid environment variable(s): ${missing}`);
    process.exit(1);
    // `throw`, not just `process.exit(1)` above: narrowing `parsed` past
    // this point depends on TS seeing this branch as unreachable, and a
    // `throw` is recognised as such under any project's `lib`/`types`
    // config — `process.exit`'s `never` return type is not (apps/mobile's
    // `AppRouter` type-only import walks this file too, under its own
    // tsconfig; `03-mobile-trpc-client.md`).
    throw new Error('unreachable — process.exit(1) already terminated the process');
  }
  return parsed.data;
}

export const env = Object.freeze(loadEnv());
