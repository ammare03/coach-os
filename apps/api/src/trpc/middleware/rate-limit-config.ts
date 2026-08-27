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
  /** 60 / min / user */
  commentsCreate: { windowSeconds: MINUTE, max: 60 },
  /** 600 / min / user — the structural fallback every procedure gets by deriving from `publicProcedure` (`procedures.ts`). */
  default: { windowSeconds: MINUTE, max: 600 },
} as const;
