import { z } from 'zod';

// Where the mobile app reads and validates its build-time configuration.
// The server counterpart is `apps/api/src/env.ts`; the two are deliberately
// not symmetrical, for two reasons that matter:
//
// 1. **Metro inlines, it does not populate.** `process.env.EXPO_PUBLIC_FOO`
//    is replaced textually with a string literal at bundle time — there is
//    no populated `process.env` object on device. Handing `process.env` to
//    a schema the way apps/api does would parse an empty bag and report
//    every variable as missing. Every name is therefore spelled out
//    literally in `rawEnv` below; a dynamic lookup silently reads nothing.
// 2. **Nothing here may fail startup.** A shipped build that refuses to
//    boot because an optional integration key is unset is a crash on a
//    coach's phone, not a helpful error. Every variable is optional and the
//    feature that reads it degrades to a documented no-op (the same call
//    apps/api makes for `SENTRY_DSN`, applied to all of them).
//
// Every variable here is `EXPO_PUBLIC_`, which means it ships inside the
// JavaScript bundle and is readable by anyone who downloads the app. Read
// the `configuration` skill §3 before adding one — a server secret must
// never carry this prefix (CLAUDE.md §25.4).
//
// **Adding a variable:** add it in two places, `rawEnv` and `envSchema`.
// (`providers-and-gates/05` adds `EXPO_PUBLIC_SENTRY_DSN` here next.)
//
// `EXPO_PUBLIC_API_URL` is not here yet — `lib/api-url.ts` reads it inside
// its dev-host fallback, where the variable is only one of three inputs.
// Folding it in is a change to that file's contract, not this task's.

// PostHog's US cloud ingestion host — the project default, and what the
// free tier (CLAUDE.md §3.4.3) is provisioned on. Overridable per build so
// an EU project or a self-hosted instance needs no code change.
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

// `.env.example` ships optional keys as `KEY=` with nothing after the `=`,
// so an empty string has to mean "absent", not "present and invalid" — the
// same trap apps/api/src/env.ts documents in `optionalNonEmpty()`.
function optionalText() {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null),
    z.string().nullable(),
  );
}

function urlWithDefault(fallback: string) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback),
    z.url(),
  );
}

const rawEnv = {
  // Write-only PostHog ingestion key — public by design (`configuration`
  // skill §3). Unset means analytics are disabled entirely, which is the
  // correct state for a fresh clone and for CI.
  EXPO_PUBLIC_POSTHOG_KEY: process.env.EXPO_PUBLIC_POSTHOG_KEY,
  EXPO_PUBLIC_POSTHOG_HOST: process.env.EXPO_PUBLIC_POSTHOG_HOST,
};

const envSchema = z.object({
  EXPO_PUBLIC_POSTHOG_KEY: optionalText(),
  EXPO_PUBLIC_POSTHOG_HOST: urlWithDefault(DEFAULT_POSTHOG_HOST),
});

export type MobileEnv = z.infer<typeof envSchema>;

const FALLBACK_ENV: MobileEnv = {
  EXPO_PUBLIC_POSTHOG_KEY: null,
  EXPO_PUBLIC_POSTHOG_HOST: DEFAULT_POSTHOG_HOST,
};

export function parseMobileEnv(input: Record<string, string | undefined>): MobileEnv {
  const parsed = envSchema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }
  // Degrade, never throw: a malformed value disables the integration that
  // reads it rather than the app. The name is safe to log — the value is
  // not, and is deliberately absent from this message.
  const invalid = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
  console.warn(`Ignoring invalid environment variable(s): ${invalid}`);
  return FALLBACK_ENV;
}

export const env = Object.freeze(parseMobileEnv(rawEnv));
