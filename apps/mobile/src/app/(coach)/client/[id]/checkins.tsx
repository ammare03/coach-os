import { useLocalSearchParams, useRouter } from 'expo-router';

import { ClientCheckinsScreen } from '../../../../features/clients/screens/ClientCheckinsScreen.tsx';

// Composition only (`CLAUDE.md` §9.2) — the screen owns its query and its
// states; this file owns the route param and where a tap goes
// (`phase-10-coach-review-surfaces/client-detail/05`).
//
// ─────────────────────────────────────────────────────────────────────────
// THE DATA CONTRACT `phase-17-structured-checkins/checkin-review/` MUST
// SATISFY
// ─────────────────────────────────────────────────────────────────────────
//
// It is written here, in committed source, rather than in the task document
// that asked for it: `.claude/plan/` is gitignored, so a plan-doc edit would
// not survive the PR that introduced the shell it describes.
//
// **The procedure.** One call — `checkins.listForClient` is the name
// `packages/schemas/src/checkins.ts` already reserves — taking
// `{ clientId }`, guarded by `ownsResource` like every other procedure that
// takes a `clientId` (`CLAUDE.md` §6.2), returning this client's
// `coaching.checkins` rows **most recent period first**:
// `ORDER BY period_end DESC, id DESC`. The tie-break on `id` is not
// decoration — two check-ins can share a `period_end` when a coach changes
// cadence mid-month, and an unstable sort is an unstable keyset cursor.
//
// **The row.** Exactly six fields, which is `ClientCheckin` in
// `features/clients/components/ClientCheckinsRow.tsx`:
//
//   | Field         | Type                       | What the row does with it        |
//   |---------------|----------------------------|----------------------------------|
//   | `checkinId`   | `string` (uuid)            | the list key, and the id the      |
//   |               |                            | detail route below takes          |
//   | `status`      | `'pending' \| 'submitted'  | the badge — all four              |
//   |               | \| 'reviewed' \| 'missed'` | `checkin_status` members, never   |
//   |               |                            | a subset                          |
//   | `periodStart` | `string`, `yyyy-MM-dd`     | the row's title                   |
//   | `periodEnd`   | `string`, `yyyy-MM-dd`     | the row's title, and the sort key |
//   | `submittedAt` | `Date \| null`             | the sub-line when `submitted`     |
//   | `reviewedAt`  | `Date \| null`             | the sub-line when `reviewed`      |
//
// **Dates versus instants, and the one mistake to avoid.** `period_start`
// and `period_end` are `date` columns — a calendar day, not a moment — so
// they cross the wire as `yyyy-MM-dd` strings and are rendered pinned to
// UTC. Serialising either as a `Date` would put 14 September on the 13th
// for every coach west of UTC (`CLAUDE.md` §25.5). `submitted_at` and
// `reviewed_at` are real `timestamptz` instants, cross the wire as `Date`
// through superjson, and are rendered in the signed-in coach's stored zone
// (`lib/time-zone/`). The row already does all four correctly; the
// procedure only has to keep the two kinds apart.
//
// **All four statuses must be returned.** Do not filter to the two
// `checkins_coach_pending` indexes — this is a history, and a `reviewed` or
// `missed` period is exactly what a coach scrolls back through. Note that
// `coach.clients.overview`'s `UpcomingCheckin` narrows `status` to
// `'pending' | 'submitted'`; that narrowing belongs to Overview's
// next-check-in query and must not be reused here.
//
// **Rows must be render-complete** (`screen-composition` §2). Nothing in
// `ClientCheckinsRow` fetches, and nothing in it may: every field above
// arrives in this one payload. A seventh field is a change to this
// contract, never a second query inside a row.
//
// **What must NOT be in the list payload:** `template_snapshot`,
// `responses`, `draft_responses`, `coach_summary`, `coach_video_asset_id`,
// and any trend or comparison. Those are the detail screen's, and shipping
// them here is fifty rows of `jsonb` that a coach scrolling past never
// reads.
//
// **Pagination is keyset, never `OFFSET`** (`api-conventions` §6). A weekly
// client accumulates 52 rows a year, so the first client to cross a page
// turns this into `useInfiniteQuery` with `(period_end, id)` as the cursor.
// The shell already renders through `FlashList`, so `onEndReached` and the
// page flattening are the only additions — the key, the row, the badge and
// the empty state do not move.
//
// **The detail link is `/(coach)/checkin/[id]`**, a route that already
// exists as a `phase-05-app-shell` placeholder and is already wired below.
// P17 builds what it shows; this tab needs no change when it does.
//
// **Where the data lands:** replace `fetchClientCheckins` in
// `features/clients/screens/ClientCheckinsScreen.tsx` with the real call,
// and delete `CHECKIN_STATUSES` in favour of the status union inferred from
// the new procedure's output. That is the whole change on this side (P10
// README, "The same pattern, four times").

export default function CoachClientCheckinsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ClientCheckinsScreen
      clientId={id}
      onOpenCheckin={(checkinId) => {
        router.push({ pathname: '/(coach)/checkin/[id]', params: { id: checkinId } });
      }}
      onOpenOverview={() => {
        // `navigate`, not `push`: Overview is a sibling facet of this same
        // `Tabs` navigator and is already mounted behind it. Pushing would
        // stack a second copy of the client screen on top of itself.
        router.navigate({ pathname: '/(coach)/client/[id]', params: { id } });
      }}
    />
  );
}
