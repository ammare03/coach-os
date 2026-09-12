import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';

import { QUERY_CACHE_MAX_AGE_MS } from '../../lib/query/persister.ts';
import { api } from '../../lib/trpc.ts';

// The `clients` feature's whole tRPC call surface (`code-conventions` §1 —
// a feature talks to the API through one module, so a query key or an
// invalidation rule has exactly one place to live). No component calls
// `api.coach.clients.*` directly.
//
// The coach DASHBOARD's read is not here: it predates this file and lives
// in `hooks/useCoachDashboard.ts`, keyed `['coach', 'dashboard']`. This
// module is the client-DETAIL screen's seven tabs.

/**
 * §8.3's tabs, in the order the facet bar draws them.
 *
 * **`notes` is last, and it arrived with `coach-notes/02`.** It was
 * deliberately absent until then — a note is private to the coach who wrote
 * it (DB§5.4), a separate authorisation story worth isolating — and the
 * route file and `_layout.tsx`'s declaration both predate it. Seven facets
 * measure past the width of the row, which is exactly what `DESIGN.md` §9
 * gives the underline-facet pattern to 5+ items *for*: the row scrolls.
 */
export const CLIENT_DETAIL_TABS = [
  'overview',
  'training',
  'nutrition',
  'videos',
  'checkins',
  'chat',
  'notes',
] as const;

export type ClientDetailTab = (typeof CLIENT_DETAIL_TABS)[number];

/**
 * **The query-key factory for every client-detail tab. Tasks 02–06 import
 * from here and never restate a key.**
 *
 * `['clients', clientId, tab]` — hierarchical, per `code-conventions` §5 and
 * `screen-composition` §2, so a caller can invalidate one tab, one client,
 * or the whole feature and never "the world". The three levels mean exactly
 * three things:
 *
 * ```
 * clientDetailKeys.all()                        every client, every tab
 * clientDetailKeys.client(id)                   one client, every tab
 * clientDetailKeys.tab(id, 'training')          one tab of one client
 * ```
 *
 * **Why literal keys rather than tRPC's own.** `@trpc/react-query` derives a
 * key from the procedure path, which would be fine for the two tabs that
 * have a procedure today — and unavailable to the four that do not. Tabs
 * 03–06 ship as shells whose data arrives with `phase-11-media-pipeline`,
 * `phase-13-nutrition`, `phase-14-messaging-and-realtime` and
 * `phase-17-structured-checkins` (the phase README's "the same pattern,
 * four times"), and a key they cannot write down yet is a key they will
 * invent separately later. One factory, written once, is what stops six
 * tabs growing six naming schemes.
 *
 * The consequence is the one thing to remember: **invalidate through
 * `queryClient.invalidateQueries({ queryKey })`, never through
 * `utils.coach.clients.overview.invalidate()`** — the latter targets tRPC's
 * key, which nothing on this screen uses.
 */
export const clientDetailKeys = {
  all: () => ['clients'] as const,
  client: (clientId: string) => ['clients', clientId] as const,
  tab: (clientId: string, tab: ClientDetailTab) => ['clients', clientId, tab] as const,
};

/**
 * How long a painted tab is treated as current.
 *
 * One minute, and the number is about navigation rather than about how fast
 * a client's week changes. A coach's review block is dashboard → client →
 * tab → tab → back → next client (`CLAUDE.md` §1.1), and every return
 * inside this window costs nothing; past it, the next return revalidates
 * behind the content already on screen. It matches
 * `COACH_DASHBOARD_STALE_TIME_MS` deliberately — the two screens are one
 * navigation apart and a coach moving between them should not meet two
 * different staleness rules.
 *
 * **Never zero.** At zero, switching to Training and back re-fetches
 * Overview, and on a slow connection the screen is a spinner over data it
 * already had — the exact failure §8.3's "switching tabs never shows a
 * spinner" acceptance criterion is written against.
 */
export const CLIENT_DETAIL_STALE_TIME_MS = 60_000;

/**
 * §8.3's Overview tab — the whole tab in one round trip.
 *
 * One `useQuery`, not five. The server assembles the weight trend, the
 * adherence figures, the current program, the next check-in, the pinned
 * notes and the injuries list into a single response
 * (`features/coach/client-overview.ts`), because the screen's premise is a
 * single glance and five awaited calls is five chances to be slow.
 *
 * `gcTime` is tied to the persistence window by import rather than by a
 * matching literal: a `gcTime` below it evicts the entry the persister just
 * restored, and the warm-cache guarantee silently becomes a cold one
 * (`lib/query/persister.ts`).
 */
export function useClientOverview(clientId: string) {
  const utils = api.useUtils();

  return useQuery({
    queryKey: clientDetailKeys.tab(clientId, 'overview'),
    queryFn: () => utils.client.coach.clients.overview.query({ clientId }),
    staleTime: CLIENT_DETAIL_STALE_TIME_MS,
    gcTime: QUERY_CACHE_MAX_AGE_MS,
  });
}

/** The whole Overview payload, inferred — never restated (`code-conventions` §3). */
export type ClientOverview = NonNullable<ReturnType<typeof useClientOverview>['data']>;
export type ClientInjury = ClientOverview['injuries'][number];
export type WeightTrendPoint = ClientOverview['weightTrend'][number];
export type AdherenceTrendPoint = ClientOverview['adherence']['trend'][number];
export type PinnedNote = ClientOverview['pinnedNotes'][number];

/** Just enough of the client to draw the header above the facet bar. */
export interface ClientIdentity {
  name: string;
  status: ClientOverview['status'];
  goal: ClientOverview['goal'];
  avatarAssetId: string | null;
  coachSince: Date | null;
}

/**
 * The identity the tab shell's header draws — name, status, goal, avatar.
 *
 * **The same cache entry as `useClientOverview`, narrowed by `select`.** The
 * header sits above all six tabs and its four fields are already in the
 * Overview payload, so giving it a query of its own would be a second round
 * trip for data the default tab has fetched anyway. `select` means the
 * header re-renders only when one of those four fields changes — a weight
 * reading landing does not touch it (`frontend-performance` §3).
 *
 * The one cost is a deep link straight to a non-default tab, where this
 * fetches Overview for a name. That is one request, on a path a coach
 * reaches by push notification rather than by tapping, and it is cheaper
 * than the alternative: a name passed through route params, which is wrong
 * the moment the client renames themselves and absent the moment the link
 * comes from outside the app.
 */
export function useClientIdentity(clientId: string) {
  const utils = api.useUtils();

  return useQuery({
    queryKey: clientDetailKeys.tab(clientId, 'overview'),
    queryFn: () => utils.client.coach.clients.overview.query({ clientId }),
    staleTime: CLIENT_DETAIL_STALE_TIME_MS,
    gcTime: QUERY_CACHE_MAX_AGE_MS,
    select: (data): ClientIdentity => ({
      name: data.name,
      status: data.status,
      goal: data.goal,
      avatarAssetId: data.avatarAssetId,
      coachSince: data.coachSince,
    }),
  });
}

/**
 * §8.3's Training tab — the session history list, keyset-paginated.
 *
 * `useInfiniteQuery` with the literal key rather than
 * `api.coach.clients.trainingHistory.useInfiniteQuery`, for the reason
 * `clientDetailKeys` states: the tab's cache entry is `['clients', id,
 * 'training']`, so this tab invalidates, persists, and evicts on the same
 * terms as the other five, and `coach-notes` or `session-review` can reach
 * it by name without knowing a tRPC path.
 *
 * `initialPageParam` is `null`, not `undefined`: `exactOptionalPropertyTypes`
 * makes an explicit `cursor: undefined` a different thing from an absent
 * one, so the first page omits the key entirely rather than sending it
 * empty.
 *
 * The list is what a coach came to the tab for, so it is fetched eagerly on
 * mount and the SECOND page is not — `getNextPageParam` returns the
 * server's own `nextCursor`, and `null` there is TanStack's "no more
 * pages", which is exactly what the server means by it.
 */
export function useClientTrainingHistory(clientId: string) {
  const utils = api.useUtils();

  return useInfiniteQuery({
    queryKey: clientDetailKeys.tab(clientId, 'training'),
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      utils.client.coach.clients.trainingHistory.query(
        pageParam === null ? { clientId } : { clientId, cursor: pageParam },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: CLIENT_DETAIL_STALE_TIME_MS,
    gcTime: QUERY_CACHE_MAX_AGE_MS,
  });
}

/** One session in the history list, inferred — never restated (`code-conventions` §3). */
export type SessionHistoryItem = NonNullable<
  ReturnType<typeof useClientTrainingHistory>['data']
>['pages'][number]['items'][number];

// ── session-review/01 ───────────────────────────────────────────────────
//
// The full-session read behind a Training-tab row. It lives in this module
// rather than a second one for `clientDetailKeys`' own reason: one feature,
// one tRPC call surface, so a key and an invalidation rule have exactly one
// home.

/**
 * `['sessions', sessionId]` — `code-conventions` §5's own key for one
 * session, and deliberately not a nested `['clients', id, 'training', …]`.
 *
 * A session is reachable without its client: a push notification deep-links
 * straight here, and the id in the route is the only thing known at that
 * point. Keying it under the client would make the cache entry unreachable
 * until the client's id was fetched, which is the waterfall this screen is
 * built to avoid.
 */
export const sessionReviewKeys = {
  all: () => ['sessions'] as const,
  detail: (sessionId: string) => ['sessions', sessionId] as const,
};

/**
 * §8.4's coach-side close: the whole session in one round trip — every set,
 * grouped by exercise in performed order, PR flags per set, skips
 * interleaved where the program put them.
 *
 * **`refetchOnWindowFocus` is OFF, and it is not a preference.**
 * `session.review` is the API's one sanctioned query-that-writes: reading
 * it sets `reviewed_at` (`features/coach/session-review.ts` decision (a)).
 * TanStack's default refires a stale query on every app foreground, so
 * leaving the default on would turn "the coach glanced at this once" into a
 * write every time the phone came out of a pocket. The write is idempotent
 * (`UPDATE … WHERE reviewed_at IS NULL`), so nothing would be corrupted —
 * but it would be a request per foreground for a screen that already has
 * its answer, on a device this product assumes is on bad signal.
 *
 * The read stays fresh the way the rest of the coach's review block does:
 * `CLIENT_DETAIL_STALE_TIME_MS`, and an explicit retry from the error
 * state.
 */
export function useSessionReview(sessionId: string) {
  const utils = api.useUtils();

  return useQuery({
    queryKey: sessionReviewKeys.detail(sessionId),
    queryFn: () => utils.client.session.review.query({ sessionId }),
    staleTime: CLIENT_DETAIL_STALE_TIME_MS,
    gcTime: QUERY_CACHE_MAX_AGE_MS,
    // See this function's doc comment — a query that writes must not be
    // re-issued by an app foreground.
    refetchOnWindowFocus: false,
  });
}

/** The whole session payload, inferred — never restated (`code-conventions` §3). */
export type SessionReview = NonNullable<ReturnType<typeof useSessionReview>['data']>;
/** One row of the session: an exercise that was performed, or one that was skipped. */
export type SessionReviewEntry = SessionReview['exercises'][number];
export type SessionReviewExerciseGroup = Extract<SessionReviewEntry, { kind: 'performed' }>;
export type SessionReviewSkippedExercise = Extract<SessionReviewEntry, { kind: 'skipped' }>;
export type SessionReviewSet = SessionReviewExerciseGroup['sets'][number];

// ── coach-notes/02 ──────────────────────────────────────────────────────
//
// §8.3's seventh tab. In this module for `clientDetailKeys`' own reason:
// one feature, one tRPC call surface, so the key AND the invalidation rule
// have exactly one home — and here that matters more than anywhere else,
// because a pin writes to two cache entries at once.

/**
 * §8.3's Notes tab — every live note this coach has written about this
 * client, keyset-paginated, newest first.
 *
 * Keyed `['clients', id, 'notes']` through the same factory as the other
 * six tabs, so it invalidates, persists, and evicts on the same terms.
 *
 * **The server orders by `created_at DESC` only.** Pinned-first is the
 * screen's grouping, applied at render (`ClientNotesScreen`), not a second
 * sort order asked of the API — which is also what makes the optimistic pin
 * re-sort free: flipping `isPinned` in the cache moves the row with no
 * refetch and no list mutation.
 */
export function useClientNotes(clientId: string) {
  const utils = api.useUtils();

  return useInfiniteQuery({
    queryKey: clientDetailKeys.tab(clientId, 'notes'),
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      utils.client.notes.listForClient.query(
        pageParam === null ? { clientId } : { clientId, cursor: pageParam },
      ),
    // `exactOptionalPropertyTypes` makes an explicit `cursor: undefined` a
    // different thing from an absent one, so the first page omits the key.
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: CLIENT_DETAIL_STALE_TIME_MS,
    gcTime: QUERY_CACHE_MAX_AGE_MS,
  });
}

/** One note, inferred — never restated (`code-conventions` §3). */
export type CoachClientNote = NonNullable<
  ReturnType<typeof useClientNotes>['data']
>['pages'][number]['items'][number];

type NotesPage = NonNullable<ReturnType<typeof useClientNotes>['data']>['pages'][number];
type NotesPages = InfiniteData<NotesPage, string | null>;

/**
 * The server's own tie-break, restated: `created_at DESC, id DESC`, and
 * `id` is a UUIDv7 so it breaks a tie in the direction the timestamp would
 * have. Used to put an undone delete back exactly where it was rather than
 * bookkeeping an index.
 */
function isBelow(item: CoachClientNote, note: CoachClientNote): boolean {
  const delta = item.createdAt.getTime() - note.createdAt.getTime();
  return delta === 0 ? item.noteId < note.noteId : delta < 0;
}

export function setPinnedInPages(data: NotesPages, noteId: string, isPinned: boolean): NotesPages {
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) => (item.noteId === noteId ? { ...item, isPinned } : item)),
    })),
  };
}

export function setBodyInPages(data: NotesPages, note: CoachClientNote): NotesPages {
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) => (item.noteId === note.noteId ? note : item)),
    })),
  };
}

export function removeNoteFromPages(data: NotesPages, noteId: string): NotesPages {
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.filter((item) => item.noteId !== noteId),
    })),
  };
}

/** Puts a note back at the position the server's ordering would have given it. */
export function insertNoteIntoPages(data: NotesPages, note: CoachClientNote): NotesPages {
  const pages = data.pages.map((page) => ({ ...page, items: [...page.items] }));

  for (const page of pages) {
    const at = page.items.findIndex((item) => isBelow(item, note));
    if (at !== -1) {
      page.items.splice(at, 0, note);
      return { ...data, pages };
    }
  }

  const last = pages[pages.length - 1];
  // No page to put it on means nothing has been read yet — `onSettled`'s
  // invalidate is what fills the list, and inventing a page here would give
  // `InfiniteData` one more page than it has `pageParams`.
  if (last === undefined) return data;
  last.items.push(note);
  return { ...data, pages };
}

/** `pinnedNotesQuery` orders by `updated_at DESC`; the patch has to agree. */
export function upsertPinnedNote(
  pinned: readonly PinnedNote[],
  note: CoachClientNote,
): PinnedNote[] {
  const entry: PinnedNote = {
    noteId: note.noteId,
    body: note.body,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
  const without = pinned.filter((item) => item.noteId !== note.noteId);
  return [...without, entry].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export function removePinnedNote(pinned: readonly PinnedNote[], noteId: string): PinnedNote[] {
  return pinned.filter((item) => item.noteId !== noteId);
}

/**
 * Both cache entries a note write touches, and the snapshot that puts them
 * back. Named once so the four mutations below cannot patch one and forget
 * the other.
 */
interface NoteCacheSnapshot {
  notes: NotesPages | undefined;
  overview: ClientOverview | undefined;
}

/**
 * **The third acceptance criterion, and the subtle one.**
 *
 * Overview's pinned notes arrive inside `client.overview`
 * (`features/coach/client-overview.ts`'s `pinnedNotesQuery`), NOT from
 * `notes.listForClient` — so "no duplicate query" is satisfied by an
 * *invalidation* relationship rather than a shared cache entry, and this
 * tab never issues a second read of the same rows.
 *
 * **Invalidation alone is not enough.** The `Tabs` navigator keeps Overview
 * mounted (`client/[id]/_layout.tsx`), so a coach who pins and immediately
 * switches tabs would see the old pinned list for one refetch. Both entries
 * are therefore patched in `onMutate` and both invalidated in `onSettled`.
 */
function useNoteCaches(clientId: string) {
  const queryClient = useQueryClient();
  const notesKey = clientDetailKeys.tab(clientId, 'notes');
  const overviewKey = clientDetailKeys.tab(clientId, 'overview');

  async function snapshot(): Promise<NoteCacheSnapshot> {
    // In flight requests would otherwise land on top of the patch.
    await Promise.all([
      queryClient.cancelQueries({ queryKey: notesKey }),
      queryClient.cancelQueries({ queryKey: overviewKey }),
    ]);
    return {
      notes: queryClient.getQueryData<NotesPages>(notesKey),
      overview: queryClient.getQueryData<ClientOverview>(overviewKey),
    };
  }

  function patch(
    previous: NoteCacheSnapshot,
    notes: (data: NotesPages) => NotesPages,
    pinnedNotes: (current: readonly PinnedNote[]) => PinnedNote[],
  ): void {
    if (previous.notes !== undefined) queryClient.setQueryData(notesKey, notes(previous.notes));
    if (previous.overview !== undefined) {
      queryClient.setQueryData(overviewKey, {
        ...previous.overview,
        pinnedNotes: pinnedNotes(previous.overview.pinnedNotes),
      });
    }
  }

  function restore(previous: NoteCacheSnapshot | undefined): void {
    if (previous === undefined) return;
    if (previous.notes !== undefined) queryClient.setQueryData(notesKey, previous.notes);
    if (previous.overview !== undefined) queryClient.setQueryData(overviewKey, previous.overview);
  }

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: notesKey });
    void queryClient.invalidateQueries({ queryKey: overviewKey });
  }

  return { snapshot, patch, restore, invalidate };
}

/**
 * §8.3's pin toggle, optimistic — `CLAUDE.md` §7.5's rule against blocking
 * on the network for an async action.
 *
 * **Not the phase-08 outbox, deliberately** (the task's Approach step 2):
 * notes are coach-authored on wifi, not client-critical data logged in a
 * basement, so a standard TanStack optimistic mutation is the whole
 * mechanism.
 */
export function useSetNotePinned(clientId: string) {
  const utils = api.useUtils();
  const caches = useNoteCaches(clientId);

  return useMutation({
    mutationFn: (input: { note: CoachClientNote; isPinned: boolean }) =>
      utils.client.notes.setPinned.mutate({
        coachNoteId: input.note.noteId,
        isPinned: input.isPinned,
      }),
    onMutate: async ({ note, isPinned }) => {
      const previous = await caches.snapshot();
      caches.patch(
        previous,
        (data) => setPinnedInPages(data, note.noteId, isPinned),
        (pinned) =>
          isPinned ? upsertPinnedNote(pinned, note) : removePinnedNote(pinned, note.noteId),
      );
      return previous;
    },
    onError: (_error, _input, previous) => {
      caches.restore(previous);
    },
    onSettled: () => {
      caches.invalidate();
    },
  });
}

/**
 * A note the coach deleted, removed from both caches and held so `Undo` can
 * put it back.
 *
 * **The server mutation is deferred, not compensated** — `useUndoToast`'s
 * documented default. `notes.delete` is a soft delete with no restore
 * procedure behind it, so an immediate write would leave `Undo` with
 * nothing to call but `create`, which would mint a new id and a new
 * `created_at` for a note the coach never meant to rewrite.
 */
export function useDeleteNote(clientId: string) {
  const utils = api.useUtils();
  const caches = useNoteCaches(clientId);

  /** Puts the note back where the server's ordering had it. */
  async function restore(note: CoachClientNote): Promise<void> {
    const previous = await caches.snapshot();
    caches.patch(
      previous,
      (data) => insertNoteIntoPages(data, note),
      (pinned) => (note.isPinned ? upsertPinnedNote(pinned, note) : [...pinned]),
    );
  }

  const remove = useMutation({
    mutationFn: (note: CoachClientNote) =>
      utils.client.notes.delete.mutate({ coachNoteId: note.noteId }),
    onError: (_error, note) => {
      // The row went before the request did, so a failure puts that one row
      // back rather than rolling a five-second-old snapshot forward over
      // whatever else the coach changed in the meantime.
      void restore(note);
    },
    onSettled: () => {
      caches.invalidate();
    },
  });

  return {
    /** Applies the optimistic removal. The toast owns what happens next. */
    hide: async (note: CoachClientNote) => {
      const previous = await caches.snapshot();
      caches.patch(
        previous,
        (data) => removeNoteFromPages(data, note.noteId),
        (pinned) => removePinnedNote(pinned, note.noteId),
      );
    },
    /** Undo, inside the five-second window: nothing was ever sent. */
    restore,
    /** The window closed untaken. */
    commit: (note: CoachClientNote) => {
      remove.mutate(note);
    },
  };
}

/**
 * `notes.create` and `notes.update`, and **neither is optimistic.**
 *
 * The composer is the one place in this tab where the coach's own words are
 * at stake, and the design's failure copy is the contract: *"Your words are
 * still here. Try again when you are back online."* An optimistic insert
 * followed by a rollback takes the sentence off the screen and then puts a
 * different screen back — the composer stays open with the text in it
 * instead, and the cache is patched only once the server has the row.
 */
export function useWriteNote(clientId: string) {
  const utils = api.useUtils();
  const caches = useNoteCaches(clientId);

  const create = useMutation({
    mutationFn: (body: string) => utils.client.notes.create.mutate({ clientId, body }),
    onSuccess: async (note) => {
      const previous = await caches.snapshot();
      // A new note is never pinned (`notes.create` has no `isPinned`
      // field), so Overview's list is untouched.
      caches.patch(
        previous,
        (data) => insertNoteIntoPages(data, note),
        (pinned) => [...pinned],
      );
    },
    onSettled: () => {
      caches.invalidate();
    },
  });

  const update = useMutation({
    mutationFn: (input: { note: CoachClientNote; body: string }) =>
      utils.client.notes.update.mutate({ coachNoteId: input.note.noteId, body: input.body }),
    onSuccess: async (note) => {
      const previous = await caches.snapshot();
      caches.patch(
        previous,
        (data) => setBodyInPages(data, note),
        // Editing a pinned note moves it to the top of Overview's list:
        // `touch_updated_at` moved `updated_at`, and that is the order
        // `pinnedNotesQuery` reads in.
        (pinned) =>
          pinned.some((item) => item.noteId === note.noteId)
            ? upsertPinnedNote(pinned, note)
            : [...pinned],
      );
    },
    onSettled: () => {
      caches.invalidate();
    },
  });

  return { create, update };
}
