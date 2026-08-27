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
  // Prepended to every key `redis-keys.ts` builds (`coachos:dev:`,
  // `coachos:preview:`, `coachos:prod:`) — Phase 1 runs every environment on
  // one free-tier Redis instance, and without this a developer's local run
  // shares a rate-limit counter and a session cache with production.
  REDIS_KEY_PREFIX: z.string().min(1),

  // 32 chars minimum — both secrets key an HMAC (HS256 for access tokens,
  // HMAC-SHA256 for refresh token digests, `auth-server/03`/`04`). A short
  // key makes the HMAC brute-forceable offline; failing to boot on a short
  // secret catches a misconfigured deploy, not the hundredth sign-in.
  JWT_SECRET: z.string().min(32),
  REFRESH_TOKEN_SECRET: z.string().min(32),

  // Social sign-in token verification (`lib/auth/provider-verification.ts`).
  // The expected `aud` claim on an inbound identity token — never a secret,
  // but required at boot so a misconfigured client id fails loudly instead
  // of silently rejecting every social sign-in. Apple: the app's bundle id
  // (native Sign In with Apple uses the bundle id as audience, not a
  // Services ID). Google: comma-separated OAuth client ids, one per
  // platform (iOS, Android) that may legitimately appear as `aud`.
  APPLE_SIGN_IN_CLIENT_ID: z.string().min(1),
  GOOGLE_SIGN_IN_CLIENT_IDS: z.string().min(1),

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
  // The one exception to "everything here is required" — unlike
  // `SENTRY_AUTH_TOKEN` above (a build-time source-map upload secret),
  // `SENTRY_DSN` gates a runtime integration that isn't load-bearing for
  // the app to function (`observability/02-sentry-integration.md`). Left
  // `undefined`, `../lib/sentry.ts`'s `Sentry.init` documents itself as a
  // no-op on every capture call — the correct behaviour for local
  // development and CI, which have no reason to require a real Sentry
  // account just to boot the server.
  SENTRY_DSN: z.string().min(1).optional(),

  // `observability/06-metrics-and-alerts.md` — the shared secret the
  // scheduled collector/evaluator trigger (`.github/workflows/metrics-cron.yml`)
  // presents on `POST /internal/metrics/collect`. Required, unlike the three
  // below: an unprotected trigger for a job that writes to the DB and can
  // fire alerts is a real hole, not a degraded-but-safe default.
  INTERNAL_JOB_SECRET: z.string().min(1),

  // Alert delivery destinations (`../lib/alerts.ts`). Both optional, same
  // reasoning as `SENTRY_DSN` above: a solo/two-person team in local dev or
  // CI has no working destination for either, and `dispatchAlert` documents
  // itself as a structured-log-only no-op for whichever one is unset, rather
  // than failing startup over an integration that isn't load-bearing for the
  // app to function.
  ALERTS_EMAIL_TO: z.string().min(1).optional(),
  ALERTS_EXPO_PUSH_TOKEN: z.string().min(1).optional(),

  // OB§4.4 / PI§4.1 — tightens alert thresholds during the pilot (any crash
  // affecting a pilot user, any `sync_failed`, same-day). One flag, removed
  // after the ship-gate-1 pilot ends.
  PILOT_MODE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
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
