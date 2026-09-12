import { useLocalSearchParams, useRouter } from 'expo-router';

import { ClientChatScreen } from '../../../../features/clients/screens/ClientChatScreen.tsx';

// Composition only (`CLAUDE.md` §9.2) — the screen owns its queries and its
// states; this file owns the route param and where the one action goes
// (`phase-10-coach-review-surfaces/client-detail/06`).
//
// ─────────────────────────────────────────────────────────────────────────
// THE DATA CONTRACT `phase-14-messaging-and-realtime/conversations/` MUST
// SATISFY
// ─────────────────────────────────────────────────────────────────────────
//
// It is written here, in committed source, rather than in the task document
// that asked for it: `.claude/plan/` is gitignored, so a plan-doc edit would
// not survive the PR that introduced the shell it describes.
//
// **The procedure.** One call, taking `{ clientId }`, guarded by
// `ownsResource` like every other procedure that takes a `clientId`
// (`CLAUDE.md` §6.2). It **resolves or creates** this coach↔client pair's
// `coaching.conversations` row and returns that row's id together with its
// messages. Resolve-or-create rather than resolve-only, in one call, for
// two reasons:
//
//   - a coach opening a never-used thread must not meet a `NOT_FOUND` for a
//     row whose absence is normal — "nobody has spoken yet" is a state, not
//     an error (`ui-conventions` §4); and
//   - the alternative is a separate `ensureConversation` mutation fired
//     before the first send, which is a second round trip on the one
//     interaction in this product that has to feel instant.
//
// The create half must be **idempotent under the pair's uniqueness
// constraint** — two devices opening the tab at once must not produce two
// conversation rows. An `INSERT … ON CONFLICT (coach_id, client_id) DO
// NOTHING RETURNING id`, falling back to a `SELECT`, is the shape; a
// read-then-write in application code races itself.
//
// It is safe to make this a `query` rather than a `mutation` despite the
// write, and it should be: the write is idempotent and unobservable, and the
// screen needs the result on mount. What it must NOT do is create the row as
// a side effect of anything a coach did not open — never in a list endpoint,
// never in a prefetch pass.
//
// **The payload.** Exactly the shape of `ClientChatThread` in
// `features/clients/screens/ClientChatScreen.tsx`:
//
//   | Field            | Type             | What the screen does with it        |
//   |------------------|------------------|-------------------------------------|
//   | `conversationId` | `string \| null` | P14's send target. The shell renders |
//   |                  | (uuid)           | nothing from it — see below.         |
//   | `messages`       | `ClientChat      | the thread, **oldest first**         |
//   |                  | Message[]`       |                                      |
//
// and each message is exactly four fields (`ClientChatBubble`'s
// `ClientChatMessage`):
//
//   | Field        | Type                      | What the bubble does with it     |
//   |--------------|---------------------------|----------------------------------|
//   | `messageId`  | `string` (uuid)           | the list key, and the id         |
//   |              |                           | `phase-26-trust-and-safety`      |
//   |              |                           | reports against                  |
//   | `authorRole` | `'coach' \| 'client'`     | which side, which fill, and the  |
//   |              |                           | words a screen reader announces  |
//   | `body`       | `string`                  | the bubble's text                |
//   | `sentAt`     | `Date`                    | the clock time in the viewer's   |
//   |              |                           | zone                             |
//
// **Order is `ORDER BY created_at ASC, id ASC`, not DESC.** The screen
// renders a natural-order `FlashList`, so oldest-first puts the newest at
// the bottom, which is what a chat means by "the latest message". The
// tie-break on `id` is not decoration: two messages can share a `created_at`
// when an offline outbox flushes a burst, and an unstable sort is an
// unstable keyset cursor. `messages.id` is uuidv7 (DB§21), so ordering by it
// is already time-ordered and the tie-break costs nothing.
//
// **`authorRole` is resolved server-side, relative to the caller.** Do not
// return a raw `sender_user_id` and let the client compare it to its own
// session — that is the same decision made in two places, and the second
// place gets it wrong the first time an assistant coach (§2, P25) views a
// thread their root owns.
//
// **Instants versus calendar dates.** `sentAt` is a real `timestamptz`
// instant and crosses the wire as a `Date` through superjson; the bubble
// renders it in the viewer's stored zone via `useClientTimeZone`. There is
// no `date` column anywhere in this payload, so §25.5's day-boundary trap
// does not apply here — but day dividers, when P14 adds them, bucket by
// `toLocalDate(sentAt, timeZone)` and never by the device's zone.
//
// **Rows must be render-complete** (`screen-composition` §2). Nothing in
// `ClientChatBubble` fetches, and nothing in it may. A fifth field — a read
// receipt, an attachment, a reaction — is a change to this contract, never a
// second query inside a bubble.
//
// **What must NOT be in this payload:** the other party's presence or
// typing state (P14 delivers those over the WebSocket, not in the thread
// read), any message from a conversation this pair does not own, and
// anything from a blocked party — `trust-and-safety` §2 rule 2 filters at
// the READ boundary and never deletes, so blocked messages are absent from
// this response while remaining in the table.
//
// **Pagination is keyset, never `OFFSET`** (`api-conventions` §6). A real
// coaching thread passes a thousand messages inside a year, so P14 turns
// this into `useInfiniteQuery` with `(created_at, id)` as the cursor,
// paging BACKWARD from the newest. The shell already renders through
// `FlashList`, so the page flattening and an `onStartReached` are the only
// additions — the key, the bubble, the notice, the empty state and the
// composer do not move.
//
// **Two things the shell renders that the contract deliberately does not
// carry.** `conversationId` decides nothing on screen: the read-only notice
// keys off whether there is at least one message, because an existing row
// with no messages is, to a coach, indistinguishable from no row at all.
// And there are no day dividers yet — `DESIGN.md` §9 specifies them, and
// they belong with the phase that has a real thread to divide, because they
// turn the list's item type into a union and that is a change worth making
// once, with data.
//
// **Where the data lands:** replace `fetchClientChatThread` in
// `features/clients/screens/ClientChatScreen.tsx` with the real call, and
// swap `ClientChatComposer` for the live one. That is the whole change on
// this side (P10 README, "The same pattern, four times"). The composer is a
// replacement, not a re-enabling — see its own header for why it can never
// be made to accept input in place.

export default function CoachClientChatScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ClientChatScreen
      clientId={id}
      onOpenOverview={() => {
        // `navigate`, not `push`: Overview is a sibling facet of this same
        // `Tabs` navigator and is already mounted behind it. Pushing would
        // stack a second copy of the client screen on top of itself.
        router.navigate({ pathname: '/(coach)/client/[id]', params: { id } });
      }}
    />
  );
}
