// The shape `token-store.ts` reads and writes. Deliberately just the four
// fields P03 `auth-client/01`'s stored-set table permits — no user summary,
// no profile. `auth-server`'s session response carries more than this; this
// module persists a subset and ignores the rest on purpose.
export type StoredSession = {
  accessToken: string;
  refreshToken: string;
  /** ISO 8601 — the access token's expiry, so the client can pre-empt it. */
  accessExpiresAt: string;
};
