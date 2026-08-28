// A synchronous, in-memory holder for the access token and its expiry.
// Deliberately not Zustand and not React state: it is read from inside
// `authLink`, a network link, where a hook cannot go — and re-rendering the
// whole app every fifteen minutes for a value nothing on screen displays
// would be pure waste (`CLAUDE.md` §10's decision tree covers state a
// *component* consumes; this is not that).
//
// The entire reason this module exists is to keep SecureStore off the hot
// path: `auth-client/04` primes it once at bootstrap, `token-store.ts`
// writes it on every `setTokens`/`clearTokens` call, and from then on this
// is the only thing `authLink` ever reads.
type CachedToken = { accessToken: string; expiresAt: string } | null;

let current: CachedToken = null;

export const tokenCache = {
  get(): CachedToken {
    return current;
  },
  set(accessToken: string, expiresAt: string): void {
    current = { accessToken, expiresAt };
  },
  clear(): void {
    current = null;
  },
};
