const MINUTE = 60;
const HOUR = 60 * MINUTE;

/**
 * CLAUDE.md §6.5's five tiers, transcribed exactly. Every value here traces
 * back to that table — change a number there and here in the same PR, never
 * one alone. Pure data only: `procedures.ts` is where these get attached to
 * an actual procedure builder — this file has no tRPC import so nothing
 * that merely reads a limit's numbers pulls in the middleware chain.
 */
export const RATE_LIMIT_TIERS = {
  /** 10 / 15 min / IP — `signIn`/`signUp`/`requestReset`/`resetPassword` share this one bucket (`rate-limit.ts`'s `authRateLimit`, not `rateLimit`). NOT `refresh` — see the next entry. */
  auth: { windowSeconds: 15 * MINUTE, max: 10 },
  /** 30 / hour / refresh-token family (`auth-server/04`). A legitimate device refreshes a few times an hour; anything past this is a client bug, not a user. `rotate-refresh-token.ts` applies this directly via `enforceRateLimit`, not `rateLimit`/`authRateLimit` — see that file's own note on why a per-IP bucket is actively harmful for this one procedure. */
  authRefresh: { windowSeconds: HOUR, max: 30 },
  /** 60 / hour / user */
  mediaCreateUploadUrl: { windowSeconds: HOUR, max: 60 },
  /** 120 / min / user */
  nutritionSearchFood: { windowSeconds: MINUTE, max: 120 },
  /** 120 / min / user — `exercise-library/02`. The same interaction as `nutrition.searchFood` (a debounced keystroke path), so the same budget. */
  exercisesSearch: { windowSeconds: MINUTE, max: 120 },
  /** 60 / min / user */
  commentsCreate: { windowSeconds: MINUTE, max: 60 },
  /** 600 / min / user — the structural fallback every procedure gets by deriving from `publicProcedure` (`procedures.ts`). */
  default: { windowSeconds: MINUTE, max: 600 },
  /** 20 / 15 min / IP — `invites.confirmGuardianConsent` (`guardian-consent/02`). Public and unauthenticated, so `rateLimit` keys it by trusted IP. The token is 256 bits, so brute force is not what this bounds; a scripted replay against the public `APP_PUBLIC_URL` page is. Deliberately NOT the shared `auth` bucket — that one is scoped to sign-in-shaped attempts, which this would pollute. */
  guardianConsentConfirm: { windowSeconds: 15 * MINUTE, max: 20 },
} as const;
