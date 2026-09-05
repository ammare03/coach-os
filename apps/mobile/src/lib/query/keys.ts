import type { CalendarDate } from '@coachos/schemas';

// The only place a TanStack Query key is constructed. Every feature phase
// from P06 onward imports from here rather than writing an array inline.
//
// Why that matters more than it looks: two arrays that *represent* the same
// query but differ by a segment are two different cache entries and two
// different invalidation targets, so a hand-written key drifts silently —
// the mutation succeeds, the list never refreshes, and nothing errors. The
// shapes below are fixed by the `code-conventions` skill §5 (the section
// `CLAUDE.md` §10.1 moved to); do not add a shape here without adding it
// there too.
//
// Every accessor returns a `readonly` tuple so the literal segments survive
// into the type. That is what lets `keys.clients.detail(id)` be recognised
// as a prefix of `keys.clients.sessions(id, page)` at the type level as
// well as at runtime, which is how narrow invalidation stays correct.

/**
 * A comment's target discriminator — `'workout_session'`, `'set_log'`,
 * `'meal'`, … Typed as `string` deliberately: the closed set lives in
 * `packages/db`'s `comment_target` enum, which the mobile app must not
 * import (`code-conventions` §7), and `packages/schemas/src/comments.ts` is
 * still empty. `phase-12-feedback-comments` narrows this to the schema's
 * inferred union when it fills that module — one type, not a copy.
 */
type CommentTargetType = string;

export const keys = {
  clients: {
    /** `['clients']` — also the prefix every other `clients` key extends. */
    list: () => ['clients'] as const,
    detail: (clientId: string) => ['clients', clientId] as const,
    sessions: (clientId: string, params: { page: number }) =>
      ['clients', clientId, 'sessions', params] as const,
  },

  sessions: {
    /** `['sessions']` — every session key at once. */
    prefix: () => ['sessions'] as const,
    detail: (sessionId: string) => ['sessions', sessionId] as const,
  },

  nutrition: {
    /** `['nutrition']` — every nutrition key at once. */
    prefix: () => ['nutrition'] as const,
    // `CalendarDate`, not `string`: a diary day is a *local* calendar date
    // resolved in the client's timezone, never `toISOString().slice(0, 10)`
    // (`code-conventions` §6, `CLAUDE.md` §25.5). The brand makes the wrong
    // one a type error instead of a wrong day for anyone not in the
    // device's timezone.
    diary: (clientId: string, dateISO: CalendarDate) =>
      ['nutrition', clientId, 'diary', dateISO] as const,
  },

  comments: {
    /** `['comments']` — every comment thread at once. */
    prefix: () => ['comments'] as const,
    list: (targetType: CommentTargetType, targetId: string) =>
      ['comments', targetType, targetId] as const,
  },

  media: {
    /** `['media']` — every media key at once. */
    prefix: () => ['media'] as const,
    detail: (assetId: string) => ['media', assetId] as const,
  },
} as const;

/**
 * The root segment of every namespace above. `persister.ts` reads this to
 * decide what may be written to disk; nothing else should need it.
 */
export const QUERY_KEY_ROOTS = ['clients', 'sessions', 'nutrition', 'comments', 'media'] as const;

export type QueryKeyRoot = (typeof QUERY_KEY_ROOTS)[number];
