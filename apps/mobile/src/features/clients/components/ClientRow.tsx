import {
  ADHERENCE_STATE_LABEL,
  AdherenceDot,
  Avatar,
  Badge,
  Pressable,
  Text,
  createThemedStyles,
  createThemedValue,
  fontSize,
  spacing,
} from '@coachos/ui';
import {
  adherenceState,
  formatLocalDate,
  formatRelativeToNow,
  type AdherenceState,
} from '@coachos/utils';
import { ChevronRight } from 'lucide-react-native';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import type { CoachDashboardClient } from '../hooks/useCoachDashboard.ts';

import {
  ClientStatusChip,
  describeClientStatus,
  type MarkableClientStatus,
} from './ClientStatusChip.tsx';

// One client, one row — §8.2's exact field list: avatar, name, two 7-day
// adherence dots (training and nutrition, separately), last-activity text,
// unread badge. Nothing else earns a place at a hundred rows.

const NAME_LINE = fontSize.label[1].lineHeight; // '20px'
const META_LINE = fontSize.micro[1].lineHeight; // '15px'
const VERTICAL_PADDING = spacing(11);
const NAME_META_GAP = spacing(3);
/** 1, not `hairlineWidth`: the prototype's row rule is a 1px line, and a
 *  half-pixel divider would make the measured height below platform-dependent. */
const DIVIDER = 1;

function px(value: string): number {
  return Number.parseInt(value, 10);
}

/**
 * **The measured row height, and the row's own `minHeight`.**
 *
 * FlashList v2 has no `estimatedItemSize` — the prop was removed with v2's
 * recycler rewrite, which measures rows itself. So this number is applied
 * to the row rather than handed to the list, and that is what `CLAUDE.md`
 * §25.8 is really asking for: every row reports a stable, uniform size on
 * first layout instead of settling over several frames.
 *
 * Derived, not guessed:
 *
 * ```
 *   11  paddingTop
 * + 20  name        — `label`, lineHeight 20
 * +  3  gap
 * + 15  meta        — `micro`, lineHeight 15
 * + 11  paddingBottom
 * +  1  divider
 * = 61
 * ```
 *
 * The 32px avatar (`sm`) and the 34px dot lane (two 15px pairs + a 4px gap)
 * both sit inside the 38px text block, so neither sets the height. Read
 * from `fontSize` rather than written as a literal, so a change to the type
 * scale moves this number with it instead of silently invalidating it.
 *
 * `micro`, not the prototype's 12px: `ProgramTemplatesScreen`'s row meta
 * is already `micro`/`muted`, and two coach list rows disagreeing by a
 * pixel is worse than either number.
 *
 * At 200% text the row grows past this — which is why it is an *estimate*
 * and why nothing here pins a fixed `height` (`accessibility` §3).
 */
export const CLIENT_ROW_HEIGHT =
  VERTICAL_PADDING * 2 + px(NAME_LINE) + NAME_META_GAP + px(META_LINE) + DIVIDER;

const DOT_LANE_WIDTH = 26;

/**
 * **Which list this row is in, which is not the same as what status it has.**
 *
 * `roster` is the default list: mixed statuses, so each row has to say which
 * one it is — a chip in the furniture, and the status leading the meta line.
 *
 * `archived` is the list behind the Archived filter, where every row is
 * archived and saying so eleven times turns a sentence into texture. Three
 * things go, and each for its own reason (the approved design, panel J):
 * the chip, because the filter above already said it; the adherence lane,
 * because a column of identical no-data rings is noise about a fact the
 * filter also already stated; and the session count, because the useful
 * fact about a finished relationship is when it ended and how long it ran.
 *
 * A MIXED selection — Archived beside Active — is `roster`, not this: the
 * moment two statuses share a list, every row owes the reader its own.
 */
export type ClientRowVariant = 'roster' | 'archived';

export interface ClientRowProps {
  client: CoachDashboardClient;
  /** Takes the id, never a closure over the row — a new arrow per row defeats `memo`. */
  onPress: (clientId: string) => void;
  variant?: ClientRowVariant;
  /** The coach's own zone. Injected only so a test has a fixed answer. */
  timeZone?: string;
  testID?: string;
}

/**
 * `React.memo` because this renders a hundred times and re-renders whenever
 * a sibling counter changes (`frontend-performance` §3).
 */
export const ClientRow = memo(function ClientRow({
  client,
  onPress,
  variant = 'roster',
  timeZone,
  testID,
}: ClientRowProps) {
  const themed = useThemedStyles();
  const chevronColor = useChevronColor();

  // **Forced to no-data for a client who is not currently being coached.**
  // Nothing was scheduled while they were paused or after they were
  // archived, so any surviving score is about a week they were not asked to
  // train in — and a red dot beside their name would say they failed at it
  // (`DESIGN.md` §10.5, `ui-conventions` §2's "grey means no data, and it is
  // distinct from red").
  const coached = !isMarkableStatus(client.status);
  const training = adherenceState(coached ? client.trainingAdherence : null);
  const nutrition = adherenceState(coached ? client.nutritionAdherence : null);
  const isArchivedList = variant === 'archived';
  const metaParts = buildMetaParts(client, variant, timeZone);
  const meta = metaParts.join(' · ');

  return (
    <Pressable
      onPress={() => {
        onPress(client.clientId);
      }}
      accessibilityRole="button"
      // One sentence per client, not six fragments: a coach scrolling a
      // hundred rows with VoiceOver hears a hundred sentences, and the two
      // dot states arrive as WORDS — which is also what makes the row
      // readable with no colour vision at all (`accessibility` §2, §4).
      accessibilityLabel={buildRowLabel({
        client,
        variant,
        training,
        nutrition,
        metaParts,
        timeZone,
      })}
      style={[styles.row, themed.divider]}
      testID={testID ?? `client-row-${client.clientId}`}
    >
      {/* Hidden from the reading order — the row's own label already says
          both states in words, and six focusable fragments per row is the
          failure `AdherenceDot`'s own contract warns about.

          Absent entirely under the Archived filter, not drawn as no-data:
          eleven identical dashed rings is a column of noise about a fact
          the filter already stated. Its width goes with it — the row has
          no reason to reserve a lane it will never fill. */}
      {isArchivedList ? null : (
        <View
          style={styles.lane}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <MetricDot letter="T" state={training} />
          <MetricDot letter="N" state={nutrition} />
        </View>
      )}

      <Avatar name={client.name} userId={client.clientId} size="sm" />

      <View style={styles.text}>
        <Text size="label" numberOfLines={1}>
          {client.name}
        </Text>
        <Text size="micro" tone="muted" numberOfLines={1} style={styles.meta}>
          {meta}
        </Text>
      </View>

      {/* The right-hand furniture, in reading order: what this client's
          state is, then what is waiting, then what the row does. Hidden
          from the reading order because the row's own label already says
          the status in words — two focus stops per client is what
          `accessibility` §2 calls noise. */}
      {isMarkableStatus(client.status) && !isArchivedList ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {/* Dated from `coach.dashboard`'s `paused_at`/`archived_at`, which
              `relationship-controls/01` added to the payload for exactly
              this. The chip still shows one word at every text size — only
              its spoken label carries the date, so the row height is
              unchanged (`CLAUDE.md` §25.8). */}
          <ClientStatusChip
            status={client.status}
            since={statusSince(client)}
            // Resolved here rather than passed through: `ClientStatusChip`
            // declares `timeZone?: string`, and under
            // `exactOptionalPropertyTypes` an explicit `undefined` is not
            // the same as omitting it. Only a marked row reaches this, so
            // the `Intl` construction is bounded by the number of paused
            // clients, not by the length of the list.
            timeZone={timeZone ?? deviceTimeZone()}
          />
        </View>
      ) : null}

      {client.unreadMessages > 0 ? <Badge count={client.unreadMessages} tone="brand" /> : null}

      <ChevronRight size={15} color={chevronColor} />
    </Pressable>
  );
});

interface MetricDotProps {
  /** `T` or `N`. The second non-colour channel for WHICH metric, beside the dot's own for which state. */
  letter: string;
  state: AdherenceState;
}

function MetricDot({ letter, state }: MetricDotProps) {
  return (
    <View style={styles.pair}>
      <Text size="micro" tone="muted" style={styles.letter}>
        {letter}
      </Text>
      <AdherenceDot state={state} size="sm" />
    </View>
  );
}

/**
 * The meta line as its parts rather than as one string, because the row and
 * the screen reader join them differently and one of them drops the first.
 *
 * Three shapes, and which one a row gets is the variant's decision, not the
 * status's:
 *
 * ```
 * roster,   active    4 of 5 sessions · active 2 hours ago
 * roster,   paused    Paused 11 Sep   · active 3 days ago
 * archived            Archived 4 Sep  · 42 weeks together
 * ```
 *
 * Facts only, never a judgement (`product-copy` §1). Loss framing ("2
 * missed") is the same fact worded as an accusation, and the coach app has
 * no more licence to shame than the client app does when the words could be
 * read aloud to a client.
 */
function buildMetaParts(
  client: CoachDashboardClient,
  variant: ClientRowVariant,
  timeZone?: string,
): string[] {
  if (variant === 'archived') {
    // No activity half: "active 8 months ago" on a finished relationship is
    // a fact about nothing. How long it ran is what a coach looking back
    // wants, and it is the only place `coachSince` is used on this screen.
    const together = describeWeeksTogether(client.coachSince, client.archivedAt);
    const lead = datedStatusLead('archived', client.archivedAt, timeZone);
    return together === null ? [lead] : [lead, together];
  }

  const sessions =
    client.sessionsScheduled7d > 0
      ? `${String(client.sessionsCompleted7d)} of ${String(client.sessionsScheduled7d)} sessions`
      : 'No sessions scheduled';

  const activity =
    client.lastActiveAt === null
      ? 'not active yet'
      : `active ${formatRelativeToNow(client.lastActiveAt)}`;

  // A paused client's session count is about the week before they were
  // paused, so it leads with the thing that explains it instead.
  const lead = isMarkableStatus(client.status)
    ? datedStatusLead(client.status, statusSince(client), timeZone)
    : sessions;

  return [lead, activity];
}

/**
 * "Paused 11 Sep", or the bare word when the timestamp is not known.
 *
 * `d MMM`, not the chip's spoken `d MMMM`: this one is competing for a
 * 15px line against the activity half beside it, and "11 September" costs
 * the room that half needs. The spoken label uses the chip's own full form
 * — see `buildRowLabel` — so nothing is abbreviated to a screen reader.
 */
function datedStatusLead(
  status: MarkableClientStatus,
  since: Date | null,
  timeZone = deviceTimeZone(),
): string {
  const word = MARKED_STATUS_LABEL[status];
  return since === null ? word : `${word} ${formatLocalDate(since, timeZone, 'd MMM')}`;
}

/**
 * The coach archived this client on this device, so the device's zone is
 * their zone — unlike a client's training day, which is read from the
 * client's stored `users.timezone` because the reader is somewhere else
 * (`CLAUDE.md` §25.5, and `ClientStatusChip`'s note on the same point).
 */
function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * "42 weeks together", or `null` when there is nothing honest to say.
 *
 * Whole weeks, floored, and never zero: a relationship archived in its
 * first week ran for a week, and "0 weeks together" reads as a data error
 * rather than as a short engagement. `null` rather than a guess when either
 * end is missing — `coach_since` is genuinely absent for a first-ever coach
 * (DB§5.1), and a made-up duration on a record a coach is looking back at
 * is worse than a shorter line.
 */
function describeWeeksTogether(coachSince: Date | null, archivedAt: Date | null): string | null {
  if (coachSince === null || archivedAt === null) return null;
  const elapsedMs = archivedAt.getTime() - coachSince.getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
  const weeks = Math.max(1, Math.floor(elapsedMs / MS_PER_WEEK));
  return `${String(weeks)} ${weeks === 1 ? 'week' : 'weeks'} together`;
}

/** The two statuses that carry a chip. `invited` is already in the meta line. */
function isMarkableStatus(status: CoachDashboardClient['status']): status is MarkableClientStatus {
  return status === 'paused' || status === 'archived';
}

/**
 * The timestamp that belongs to the status the row is showing.
 *
 * `client_status_timestamps` allows a row to carry both — an archived
 * client may have been paused first, and `archived_at` does not clear
 * `paused_at` — so this reads the one the CURRENT status is about rather
 * than the first one it finds.
 */
function statusSince(client: CoachDashboardClient): Date | null {
  if (client.status === 'archived') return client.archivedAt;
  if (client.status === 'paused') return client.pausedAt;
  return null;
}

const MARKED_STATUS_LABEL: Record<MarkableClientStatus, string> = {
  paused: 'Paused',
  archived: 'Archived',
};

interface RowLabelInput {
  client: CoachDashboardClient;
  variant: ClientRowVariant;
  training: AdherenceState;
  nutrition: AdherenceState;
  metaParts: string[];
  /**
   * Explicitly `| undefined` rather than optional: the call site always
   * passes the key, and `exactOptionalPropertyTypes` treats "absent" and
   * "present but undefined" as different types.
   */
  timeZone: string | undefined;
}

function buildRowLabel({
  client,
  variant,
  training,
  nutrition,
  metaParts,
  timeZone,
}: RowLabelInput): string {
  // The narrowed status rather than a boolean: a `boolean` const does not
  // carry the type predicate to `describeClientStatus`, which takes the two
  // markable statuses and not the whole enum.
  const marked: MarkableClientStatus | null = isMarkableStatus(client.status)
    ? client.status
    : null;

  // Straight after the name, because it changes what every number after it
  // means — and because the chip that carries it visually is hidden from
  // the reading order, so this is the only place it is said. Spoken through
  // the chip's OWN sentence builder, so a coach hears the same words here
  // and on the detail header rather than two wordings of one fact.
  const state =
    marked === null ? '' : ` ${describeClientStatus(marked, statusSince(client), timeZone)}.`;

  // Dropped under the Archived filter, where the lane is not drawn either:
  // there is no score to report about weeks nobody was asked to train in,
  // and saying "not started" eleven times is the same noise in words.
  const adherence =
    variant === 'archived'
      ? ''
      : `Training ${ADHERENCE_STATE_LABEL[training].toLowerCase()}, nutrition ${ADHERENCE_STATE_LABEL[nutrition].toLowerCase()}. `;

  // The first part IS the status once a row leads with it, and `state`
  // above has already said it in full. Repeating an abbreviated "Paused 11
  // Sep" straight after "Paused since 11 September" is the duplication the
  // one-sentence-per-row rule exists to prevent (`accessibility` §2).
  const spoken = (marked === null ? metaParts : metaParts.slice(1)).join(', ');
  const tail = spoken === '' ? '' : `${spoken}.`;

  const unread = client.unreadMessages;
  const messages =
    unread === 0 ? '' : ` ${String(unread)} unread ${unread === 1 ? 'message' : 'messages'}.`;

  return `${client.name}.${state} ${adherence}${tail}${messages}`.trimEnd();
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(11),
    // `minHeight` and padding, never `height` — at 200% text the name and
    // meta lines grow and a fixed row would clip both.
    minHeight: CLIENT_ROW_HEIGHT,
    paddingVertical: VERTICAL_PADDING,
    borderBottomWidth: DIVIDER,
  },
  // `minWidth` on both, so the lane and the letters still line up at the
  // default scale and grow rather than clip at 200% (`accessibility` §3).
  lane: { minWidth: DOT_LANE_WIDTH, gap: spacing(4) },
  pair: { flexDirection: 'row', alignItems: 'center', gap: spacing(5) },
  letter: { minWidth: 8, textAlign: 'center' },
  text: { flex: 1, minWidth: 0 },
  meta: { marginTop: NAME_META_GAP },
});

const useThemedStyles = createThemedStyles((t) => ({
  divider: { borderBottomColor: t.colors.border.soft },
}));

// `fg.faint` never carries meaning (`DESIGN.md` §13) — the chevron says
// "this opens", which the row's `button` role already says out loud.
const useChevronColor = createThemedValue((t) => t.colors.fg.faint);
