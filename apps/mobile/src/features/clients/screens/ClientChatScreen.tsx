import {
  Card,
  EmptyState,
  LoadingState,
  Text,
  createThemedStyles,
  createThemedValue,
  density,
  spacing,
} from '@coachos/ui';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { Lock, MessageSquare, TriangleAlert } from 'lucide-react-native';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { QUERY_CACHE_MAX_AGE_MS } from '../../../lib/query/persister.ts';
import { useClientTimeZone } from '../../../lib/time-zone/useClientTimeZone.ts';
import { CLIENT_DETAIL_STALE_TIME_MS, clientDetailKeys, useClientIdentity } from '../api.ts';
import { ClientChatBubble, type ClientChatMessage } from '../components/ClientChatBubble.tsx';
import { ClientChatComposer } from '../components/ClientChatComposer.tsx';

// §8.3's Chat facet — a bubble thread over §8.8's coach↔client conversation.
//
// **A forward hook, and deliberately only that** (P10 README, "The same
// pattern, four times"). What ships here is the facet's own cache entry, the
// bubble list, two distinct absences, and a composer that cannot take input.
// What fills it ships with `phase-14-messaging-and-realtime/conversations/`,
// against the contract stated in full in `app/(coach)/client/[id]/chat.tsx`.
//
// **The one wrinkle this facet has and the other three forward hooks do
// not:** a `coaching.conversations` row for this pair may ALREADY exist by
// the time the tab is opened — P01 shipped the table, and P14 creates the
// row lazily on first message. So there are two absences here, not one, and
// they get two treatments (`ClientChatBody` and `ReadOnlyNotice` below).
//
// **No per-section error boundary**, for the same reason
// `ClientOverviewScreen` and `ClientCheckinsScreen` have none: one query
// means there is no one part that can fail alone, and the facet bar and back
// control live in `_layout.tsx`, so a failed Chat tab leaves the other five
// facets working.
//
// **Where `phase-26-trust-and-safety` attaches** (`CLAUDE.md` §21.6 — report
// reachable in ≤2 taps from any message, for both roles). Nothing here is
// built now and nothing here blocks it: the bubble is ONE accessible,
// self-contained node per message carrying its own `messageId`, so P26 wraps
// it in a long-press target without restructuring the row; and the thread is
// a `FlashList` already keyed by message id, so a blocked party's messages
// are filtered at the READ boundary by the procedure and never deleted here
// (`trust-and-safety` §2 rule 2). The conversation-level Block action belongs
// on the tab shell's header overflow control in `_layout.tsx`, not here.

/**
 * One frozen array, not a fresh `[]` per render: it is `FlashList`'s `data`
 * before the query resolves, and a new reference each render would make the
 * list re-key its (empty) window on every re-render.
 */
const EMPTY_MESSAGES: readonly ClientChatMessage[] = [];

/**
 * What the Chat tab reads. **This is the shape
 * `phase-14-messaging-and-realtime` must return** — the full contract, with
 * its reasoning, is in `app/(coach)/client/[id]/chat.tsx`.
 */
export interface ClientChatThread {
  /**
   * `null` when no `coaching.conversations` row exists for this pair yet.
   * P14 needs it to send; nothing on this screen renders from it — see the
   * `ListHeaderComponent` note on why the notice keys off message count.
   */
  conversationId: string | null;
  /** Oldest first, so the newest renders at the bottom of a natural-order list. */
  messages: readonly ClientChatMessage[];
}

const EMPTY_THREAD: ClientChatThread = { conversationId: null, messages: EMPTY_MESSAGES };

/**
 * **The seam, and the only function `phase-14-messaging-and-realtime`
 * replaces.**
 *
 * There is no conversations procedure to call yet. Resolving to an empty
 * thread rather than leaving the query un-fired is what makes the tab's
 * cache entry, its stale window, its loading state and both of its absences
 * real today, so none of them is written for the first time under pressure
 * when the data arrives.
 *
 * It takes a `clientId` it does not use for exactly that reason: the shape
 * of the call is already the shape P14 needs.
 */
async function fetchClientChatThread(clientId: string): Promise<ClientChatThread> {
  void clientId;
  return EMPTY_THREAD;
}

/**
 * §8.3's Chat tab, on its own cache entry.
 *
 * The key is `clientDetailKeys.tab(clientId, 'chat')` — the factory
 * `client-detail/01` owns, never a key restated here — which is what makes
 * this tab independently cached and independently invalidatable
 * (`code-conventions` §5). `gcTime` is tied to the persistence window by
 * import rather than by a matching literal, for the same reason
 * `useClientOverview` ties it: a `gcTime` below it evicts the entry the
 * persister just restored and the warm-cache guarantee silently becomes a
 * cold one.
 */
export function useClientChatThread(clientId: string) {
  return useQuery({
    queryKey: clientDetailKeys.tab(clientId, 'chat'),
    queryFn: () => fetchClientChatThread(clientId),
    staleTime: CLIENT_DETAIL_STALE_TIME_MS,
    gcTime: QUERY_CACHE_MAX_AGE_MS,
  });
}

export interface ClientChatScreenProps {
  clientId: string;
  /** The empty state's one next step. Never a query-dependent action (`screen-composition` §3). */
  onOpenOverview: () => void;
}

/**
 * Who a client-authored bubble is announced as before the name lands, and
 * on the one path where it never does (a deep link opened offline with no
 * warm Overview cache). Not a blank and not "Unknown": a screen reader
 * hearing "From , 19:02" has lost the only channel that carries authorship
 * here, since alignment and colour are both invisible to it.
 */
const UNNAMED_CLIENT = 'your client';

export function ClientChatScreen({ clientId, onOpenOverview }: ClientChatScreenProps) {
  const themed = useThemedStyles();
  // Resolved once for the whole thread, not per bubble. In the coach app the
  // signed-in user is the coach, so this is the coach's own stored zone —
  // the right one for "when did this land for me".
  const timeZone = useClientTimeZone();
  // The SAME cache entry the tab shell's header already subscribes to,
  // narrowed by `select` (`useClientIdentity`'s own contract) — so this is a
  // subscription rather than a round trip on every path except a deep link
  // straight to this facet. It is read here rather than passed down as a
  // prop so the route file stays composition-only (`CLAUDE.md` §9.2), and it
  // fires in parallel with the thread query at mount, never after it
  // (`screen-composition` §2).
  const identity = useClientIdentity(clientId);
  const clientName = identity.data?.name ?? UNNAMED_CLIENT;
  const thread = useClientChatThread(clientId);
  const messages = thread.data?.messages ?? EMPTY_MESSAGES;

  // Stable across renders, so `ClientChatBubble`'s `memo` is not defeated by
  // a new arrow per row (`frontend-performance` §3).
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ClientChatMessage>) => (
      <ClientChatBubble message={item} clientName={clientName} timeZone={timeZone} />
    ),
    [clientName, timeZone],
  );

  return (
    <View style={[styles.flex, themed.screen]} testID="client-chat">
      {/* `FlashList` v2, and deliberately no size prop: `estimatedItemSize`
          does not exist in 2.0.2 — passing it is a type error, not a tuning
          choice (`CLAUDE.md` §25.8). A bubble's height is its text's, so
          there is no uniform row constant to pin down here either; v2's
          recycler measures each row itself, which is the case it was
          rewritten for. */}
      <FlashList
        data={messages}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        // Only when there is something to read. The notice's whole job is to
        // explain why a coach can read but not reply — with nothing to read
        // there is nothing to explain, and the empty state below already
        // says it. That is also why it keys off message count rather than
        // off `conversationId`: an existing row with no messages is, to a
        // coach, indistinguishable from no row at all.
        ListHeaderComponent={messages.length > 0 ? <ReadOnlyNotice /> : null}
        ListEmptyComponent={
          <ClientChatBody
            isPending={thread.isPending}
            isError={thread.isError}
            onRetry={() => {
              void thread.refetch();
            }}
            onOpenOverview={onOpenOverview}
          />
        }
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      />

      {/* Outside the list and always mounted — in both absences and in a
          full thread. `screen-composition` §3: the control at the bottom of
          a screen must not depend on the query above it, and a composer
          that appears only sometimes is a composer a coach cannot learn. */}
      <ClientChatComposer />
    </View>
  );
}

function keyExtractor(message: ClientChatMessage): string {
  return message.messageId;
}

/**
 * Absence #2: a conversation exists, and this build cannot reach the live
 * half of it.
 *
 * Drawn as an INSET well — the same recession `InjuriesBanner` uses, and for
 * the same reason: §7.2 reserves the warmth ramp for adherence, so a notice
 * may not borrow `urgent` to say "read me". It separates by sinking rather
 * than by colour.
 *
 * Deliberately shaped nothing like `ClientChatBody`'s centred empty state.
 * The two situations are different, and a coach should be able to tell them
 * apart from the doorway — this task's own acceptance criterion.
 */
function ReadOnlyNotice() {
  const iconColor = useMutedIconColor();

  return (
    <View style={styles.notice}>
      <Card elevation="inset" density="coach" testID="client-chat-readonly-notice">
        <View style={styles.noticeRow}>
          <Lock size={17} color={iconColor} style={styles.noticeIcon} />

          <View style={styles.noticeBody}>
            <Text size="eyebrow" tone="warm-muted">
              READ-ONLY
            </Text>
            <Text size="body-sm" tone="muted" style={styles.noticeText}>
              {
                "Earlier messages are shown here. This version of CoachOS can't send or receive new ones."
              }
            </Text>
          </View>
        </View>
      </Card>
    </View>
  );
}

interface ClientChatBodyProps {
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  onOpenOverview: () => void;
}

/**
 * The three states this thread can be in with no bubbles to draw
 * (`ui-conventions` §4).
 *
 * **Forbidden is absent, deliberately.** `ERRORS.md` ER§2.1 makes another
 * coach's client return `NOT_FOUND` rather than `FORBIDDEN`, so a wrong id
 * is caught one layer up by the tab shell's header — a 403 here would
 * confirm the row exists and turn id-walking into an enumeration oracle.
 */
function ClientChatBody({ isPending, isError, onRetry, onOpenOverview }: ClientChatBodyProps) {
  const iconColor = useMutedIconColor();

  if (isPending) {
    return (
      <LoadingState shape="list" rows={4} density="coach" accessibilityLabel="Loading messages" />
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={<TriangleAlert size={22} color={iconColor} />}
        title="We couldn't load this conversation"
        body="Check your connection and try again. Nothing either of you has sent is affected."
        primaryAction={{ label: 'Try again', onPress: onRetry }}
        density="coach"
        testID="client-chat-error"
      />
    );
  }

  // Absence #1: nothing has ever been said.
  //
  // States the fact and offers one next step, with no apology and no
  // exclamation mark (`COPY.md` §CO4.1). **The action is Overview, and that
  // is the P14 slot** — an inert "Send a message" button would be exactly
  // the broken-hook failure the phase README names outright, so the honest
  // next step is the week this coach came to review. P14 replaces this
  // action in place and nothing else on the screen moves.
  return (
    <EmptyState
      icon={<MessageSquare size={22} color={iconColor} />}
      title="No messages yet"
      body="Nothing has been sent between you and this client."
      primaryAction={{ label: 'Back to overview', onPress: onOpenOverview }}
      density="coach"
      testID="client-chat-empty"
    />
  );
}

const GUTTER = density.coach.gutter;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: GUTTER, paddingTop: spacing(14), paddingBottom: spacing(14) },
  notice: { marginBottom: spacing(12) },
  noticeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing(11) },
  noticeIcon: { marginTop: spacing(3) },
  noticeBody: { flex: 1, minWidth: 0 },
  noticeText: { marginTop: spacing(4) },
});

const useThemedStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.colors.bg.DEFAULT },
}));

const useMutedIconColor = createThemedValue((t) => t.colors.fg.muted);
