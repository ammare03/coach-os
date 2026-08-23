// Per-request memo for `../middleware/owns-resource.ts` — `03-owns-resource.md`
// step 9: two guards on one procedure resolving to the same row cost one
// query. Lives on the request (`../context.ts`), created once per request by
// the context factory, discarded when the request ends. Never Redis, never
// anything durable — step 9's own risk note: a stale ownership answer is a
// window in which a transferred client's data is still readable by their
// previous coach, and this system gets no cache tier that survives past one
// request.
export type OwnershipCache = Map<string, boolean>;

export function createOwnershipCache(): OwnershipCache {
  return new Map();
}

export function ownershipCacheKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}
