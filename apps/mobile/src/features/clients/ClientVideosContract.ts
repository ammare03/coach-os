import { clientDetailKeys } from './api.ts';

// §8.3's Videos facet: "grid of form-check uploads, unreviewed first."
//
// **This module is a contract, not an implementation.** P10 ships the facet,
// its cache key, its grid geometry, and its empty state;
// `phase-11-media-pipeline/playback/` ships the procedure that fills it. This
// file is the one place that states, precisely enough to implement directly,
// what that procedure must return and in what order — so P11 writes a query
// against a written spec rather than re-deriving it from a screen, and so the
// shell needs no change on either side when it lands (the P10 README's
// "the same pattern, four times").
//
// Nothing here queries. There is deliberately no `useClientVideos` hook: a
// hook with no procedure behind it is either a lie or a second empty state.
//
// ── THE SORT ──────────────────────────────────────────────────────────────
//
// **Stated in full, because "unreviewed first" under-specifies into "newest
// first" the moment only the second key is written.**
//
// DB§22's coach-inbox pattern, and the same `NOT EXISTS` predicate
// `v_client_overview.unreviewed_videos` already uses — so the badge on the
// dashboard row and the tiles on this grid can never disagree about what
// "unreviewed" means.
//
// ```sql
// SELECT ...
//   FROM coaching.media_assets ma
//  WHERE ma.client_id = $1
//    AND ma.kind = 'video'
//    AND ma.deleted_at IS NULL
//  ORDER BY
//    (NOT EXISTS (SELECT 1 FROM coaching.comments c
//                  WHERE c.target_type = 'media_asset'
//                    AND c.target_id = ma.id)) DESC,   -- unreviewed first
//    ma.created_at DESC,                               -- then newest first
//    ma.id DESC                                        -- stable tiebreak (uuidv7)
// ```
//
// Two keys, in that order, and the order is the whole feature: a five-week-old
// unreviewed squat outranks yesterday's reviewed bench. Sorting on
// `created_at` alone produces a grid that looks plausible and buries exactly
// the videos a coach opened the tab to find.
//
// Three properties that are easy to lose:
//
//   - **It is a sort, not a filter.** Reviewed videos stay in the same list, in
//     the same grid, undimmed — a coach re-watches an old lift constantly. Two
//     queries, or a `WHERE` that hides them, is the wrong shape.
//   - **The client never re-sorts.** `ClientVideosGrid` renders the array in
//     the order it was given. A second ordering in JS is a second
//     implementation to keep in sync, and it would disagree with the keyset
//     page boundary.
//   - **It does NOT filter on `processing_status = 'ready'`, and
//     `v_client_overview.unreviewed_videos` DOES.** That difference is
//     deliberate: the counter must not promise a coach a video they cannot open
//     yet, while the grid must show a client's newest upload the moment it
//     exists. So a still-processing form check appears on this grid and is not
//     in that count. P11 must not "fix" the disagreement by changing either one.
//
// `ma.id DESC` is not decoration — it is what makes keyset pagination
// (`api-conventions` §6) reproducible when two uploads share a `created_at`.

/**
 * **The Videos tab's cache key.** `['clients', clientId, 'videos']`, through
 * `client-detail/01`'s factory rather than restated — the six tabs share one
 * naming scheme precisely so an invalidation can name one tab, one client, or
 * the feature (`api.ts`, `code-conventions` §5).
 *
 * P11's `useQuery` uses THIS, not `@trpc/react-query`'s derived key. A tRPC
 * key would be a seventh scheme on a screen that already has one, and
 * `clientDetailKeys.client(id)` would stop reaching this tab.
 */
export function clientVideosQueryKey(clientId: string) {
  return clientDetailKeys.tab(clientId, 'videos');
}

/**
 * One row per tile, and **everything a tile draws is on it**.
 *
 * The rule this shape exists to keep is `screen-composition` §2's: no query
 * inside a list row. A tile that asks for its own duration, its own comment
 * count, or its own reviewed flag turns one scroll into eight requests and
 * costs the frames `CLAUDE.md` §19 budgets for the grid.
 *
 * **No signed URL is on this row, and adding one is a security defect**, not a
 * convenience. A signed R2 URL is a live credential with a ≤1h life
 * (`security-and-privacy` §4); a list response is cached by TanStack Query,
 * persisted to SQLite by the persister, and reachable from a Sentry
 * breadcrumb. The tile gets `thumbnailKey` — an opaque object key — and P11
 * mints a URL per view. Form-check video is Sensitive class (`CLAUDE.md`
 * §21.1): the key, the URL, and `exerciseName` never reach a log or an
 * analytics event.
 */
export interface ClientFormCheck {
  /** `coaching.media_assets.id`. uuidv7, so it is also a stable time-ordered tiebreak. */
  mediaAssetId: string;
  /**
   * `media_assets.thumbnail_key` — the R2 object key, never a URL. Null until
   * the transcode worker writes one, which is why the tile has a designed
   * placeholder rather than a blank box.
   */
  thumbnailKey: string | null;
  /**
   * `media_assets.processing_status`. The tile renders a caption from it while
   * the frame is not yet available, so a client's newest upload is visible to
   * their coach the moment it lands rather than after transcode.
   */
  processingStatus: 'uploading' | 'processing' | 'ready' | 'failed' | 'deleted';
  /**
   * `media_assets.duration_seconds`, **already a number**. The column is
   * Postgres `numeric`, which Drizzle hands back as a string — parsed once at
   * the API boundary, never per tile (`code-conventions` §3, the numeric trap).
   * Null while the duration is still unknown.
   */
  durationSeconds: number | null;
  /** `media_assets.created_at` — when the client uploaded it. The sort's second key. */
  capturedAt: Date;
  /**
   * The sort's FIRST key, resolved server-side: `NOT EXISTS (a comment
   * targeting this asset)`, inverted. The client never recomputes it.
   */
  isReviewed: boolean;
  /** How many comments target this asset. The caption's "2 comments"; 0 when unreviewed. */
  commentCount: number;
  /**
   * `exercises.name` via `media_assets.exercise_id`, and null for a form check
   * filmed outside a prescribed lift. Sensitive-adjacent: it names what a
   * person was doing, so it stays out of logs and events like the rest of the
   * row.
   */
  exerciseName: string | null;
  /** `set_logs.set_number` via `media_assets.set_log_id`. Null when the video is not tied to a set. */
  setNumber: number | null;
}
