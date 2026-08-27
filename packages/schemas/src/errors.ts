// The `cause.code` catalogue (CLAUDE.md §6.3, §15.8) — the closed list of
// machine-readable error codes a CoachOS client can ever receive. A union,
// not an enum: a client `switch (code) { ... }` with a case removed fails
// `pnpm check`'s typecheck, which is the whole reason it's shaped this way.
//
// Seeded from `api-conventions` §5's thirteen product codes, plus five
// infrastructure codes `02-error-formatter-and-codes.md` throws and one more
// `04-no-raw-db-errors.md` throws — no product feature sits behind either
// group, which is why they weren't already in the skill. Any code added
// here must be added to that table in the same PR, or the two drift.
export const APP_ERROR_CODES = [
  // api-conventions §5 — product codes
  'SEAT_LIMIT_REACHED',
  'STORAGE_QUOTA_EXCEEDED',
  'LIVE_MINUTES_EXHAUSTED',
  'AI_LIMIT_REACHED',
  'FEATURE_NOT_IN_TIER',
  'NOT_YOUR_CLIENT',
  'MEDIA_STILL_PROCESSING',
  'CHECKIN_ALREADY_SUBMITTED',
  'CLIENT_ALREADY_HAS_COACH',
  'INVITE_EXPIRED',
  'RECORDING_CONSENT_REQUIRED',
  'SYNC_CONFLICT',
  'VALIDATION_FAILED',
  // infrastructure codes — 02
  'AUTH_REQUIRED',
  'ROLE_REQUIRED',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'INTERNAL_ERROR',
  // infrastructure code — 04: a unique violation the constraint map has no
  // specific product code for. Distinct from SYNC_CONFLICT, which means
  // "refetch, a write raced you" — this means "a duplicate the server
  // refused", a different recovery action the client can't merge into.
  'UNKNOWN_CONFLICT',
  // auth-server/04 — refresh rotation. Two codes, deliberately distinct
  // (04's Produces table): a reused token means the session is gone for
  // good (sign out, clear storage); a race means a concurrent refresh from
  // the same device is already in flight (wait and retry once, never sign
  // out). Collapsing the two into one code produces random sign-outs.
  'REFRESH_TOKEN_REUSED',
  'REFRESH_RACE',
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

// tRPC's own error-code union, re-declared rather than imported so this
// package's one runtime dependency stays zod (`code-conventions` §1's
// package table — no @trpc/server here). The literal strings must match
// `TRPC_ERROR_CODE_KEY` exactly; `apps/api/src/lib/app-error.ts` passes a
// value of this type straight into `new TRPCError({ code })`, so a typo
// here fails `pnpm check` at that call site rather than surfacing at
// runtime.
export type TRPCErrorCodeName =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'TOO_MANY_REQUESTS'
  | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL_SERVER_ERROR';

/** Every code's transport mapping — `api-conventions` §5's "tRPC code" column, machine-checked below. */
export const APP_ERROR_TRPC_CODE: Record<AppErrorCode, TRPCErrorCodeName> = {
  SEAT_LIMIT_REACHED: 'BAD_REQUEST',
  STORAGE_QUOTA_EXCEEDED: 'BAD_REQUEST',
  LIVE_MINUTES_EXHAUSTED: 'BAD_REQUEST',
  AI_LIMIT_REACHED: 'BAD_REQUEST',
  FEATURE_NOT_IN_TIER: 'FORBIDDEN',
  NOT_YOUR_CLIENT: 'FORBIDDEN',
  MEDIA_STILL_PROCESSING: 'CONFLICT',
  CHECKIN_ALREADY_SUBMITTED: 'CONFLICT',
  CLIENT_ALREADY_HAS_COACH: 'CONFLICT',
  INVITE_EXPIRED: 'BAD_REQUEST',
  RECORDING_CONSENT_REQUIRED: 'FORBIDDEN',
  SYNC_CONFLICT: 'CONFLICT',
  VALIDATION_FAILED: 'BAD_REQUEST',
  AUTH_REQUIRED: 'UNAUTHORIZED',
  ROLE_REQUIRED: 'FORBIDDEN',
  RATE_LIMITED: 'TOO_MANY_REQUESTS',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  INTERNAL_ERROR: 'INTERNAL_SERVER_ERROR',
  UNKNOWN_CONFLICT: 'CONFLICT',
  REFRESH_TOKEN_REUSED: 'UNAUTHORIZED',
  REFRESH_RACE: 'CONFLICT',
};

/**
 * The empty payload — DB§18: a code whose only useful signal is which code
 * it is. `NOT_YOUR_CLIENT` carries this and nothing else (02's step 2):
 * naming the id that failed would hand back the oracle
 * `../authorization-middleware/03-owns-resource.md` closed.
 */
export type EmptyErrorPayload = Record<string, never>;

/**
 * Per-code payload shapes. DB§18 governs every field here: counts, limits,
 * ids, and statuses (🟢 operational) are allowed; a name, an email, a food
 * name, an injury note, or a media URL is never allowed in an error
 * payload — it is a log line and a Sentry event waiting to happen (02's
 * step 2 and its Risks section).
 */
export interface AppErrorPayloads {
  SEAT_LIMIT_REACHED: { seatsUsed: number; seatLimit: number };
  STORAGE_QUOTA_EXCEEDED: { usedBytes: number; limitBytes: number };
  LIVE_MINUTES_EXHAUSTED: { minutesUsed: number; minutesLimit: number };
  AI_LIMIT_REACHED: { generationsUsed: number; generationsLimit: number };
  FEATURE_NOT_IN_TIER: { feature: string; requiredTier: string };
  NOT_YOUR_CLIENT: EmptyErrorPayload;
  MEDIA_STILL_PROCESSING: { mediaAssetId: string };
  CHECKIN_ALREADY_SUBMITTED: { checkinId: string };
  CLIENT_ALREADY_HAS_COACH: EmptyErrorPayload;
  INVITE_EXPIRED: { expiredAt: string };
  RECORDING_CONSENT_REQUIRED: EmptyErrorPayload;
  SYNC_CONFLICT: { entity: string };
  VALIDATION_FAILED: { fields: Record<string, string> };
  AUTH_REQUIRED: EmptyErrorPayload;
  ROLE_REQUIRED: { requiredRole: string };
  RATE_LIMITED: { retryAfterSeconds: number };
  PAYLOAD_TOO_LARGE: { maxBytes: number };
  INTERNAL_ERROR: EmptyErrorPayload;
  // No constraint name, table, or column — DB§18: that's exactly the
  // disclosure this code exists to avoid (04's step 7).
  UNKNOWN_CONFLICT: EmptyErrorPayload;
  REFRESH_TOKEN_REUSED: EmptyErrorPayload;
  REFRESH_RACE: EmptyErrorPayload;
}

/**
 * True for every code except `INTERNAL_ERROR`. `INTERNAL_ERROR` is the one
 * code nobody throws deliberately — the formatter (`../trpc/error-formatter.ts`)
 * assigns it only when redacting an error nothing else caught, so it is the
 * whole of the "unexpected" bucket by construction. Every other code was
 * thrown on purpose via `appError()`: a refusal the product designed for,
 * not a crash. `../observability/02-sentry-server.md` uses this one
 * definition to decide whether a rejection should also consume Sentry's 5k
 * errors/month free tier (CLAUDE.md §3.4.3) — it should not, for a coach
 * hitting their seat limit.
 */
export function isExpectedAppErrorCode(code: AppErrorCode): boolean {
  return code !== 'INTERNAL_ERROR';
}
