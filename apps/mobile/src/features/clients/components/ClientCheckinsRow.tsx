import {
  Chip,
  Pressable,
  Text,
  createThemedStyles,
  createThemedValue,
  fontSize,
  spacing,
} from '@coachos/ui';
import { formatLocalDate } from '@coachos/utils';
import { ChevronRight } from 'lucide-react-native';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

// One check-in, one row (`client-detail/05`). The shell `phase-17-structured-
// checkins/checkin-review/` drops real rows into — everything a row shows
// arrives in the list payload, and nothing here fetches
// (`screen-composition` §2).

/**
 * `coaching.checkins.status`, all four members, in the order
 * `packages/db/src/schema/enums.ts` declares them.
 *
 * Written down rather than inferred, and that is a temporary state of
 * affairs with a test holding it honest. The type exists in exactly one
 * place today — the `checkin_status` pgEnum — and `packages/db` is a
 * **devDependency** of `apps/mobile`, so production code may not reach it
 * (`code-conventions` §7: the app never touches the database). The wire
 * type that would normally supply it does not exist yet: `packages/schemas/
 * src/checkins.ts` is an empty module P17 owns, and `coach.clients.
 * overview`'s `UpcomingCheckin` narrows `status` to `'pending' |
 * 'submitted'` — two of the four.
 *
 * So `ClientCheckinsRow.test.tsx` pins this array against
 * `schema.checkinStatus.enumValues` from `@coachos/db`, the same way
 * `pr-celebration.test.ts` pins `PR_PRIORITY`. When P17 ships a procedure,
 * this union is deleted and `CheckinStatus` is inferred from its output.
 */
export const CHECKIN_STATUSES = ['pending', 'submitted', 'reviewed', 'missed'] as const;

export type CheckinStatus = (typeof CHECKIN_STATUSES)[number];

/**
 * One row of the Check-ins tab — the whole contract `phase-17-structured-
 * checkins` fills. Stated in full in the route file,
 * `app/(coach)/client/[id]/checkins.tsx`.
 */
export interface ClientCheckin {
  checkinId: string;
  status: CheckinStatus;
  /** `yyyy-MM-dd` — a calendar day, never an instant (`code-conventions` §6). */
  periodStart: string;
  periodEnd: string;
  /** A real instant, rendered in the signed-in coach's own zone. */
  submittedAt: Date | null;
  reviewedAt: Date | null;
}

interface StatusBadge {
  label: string;
  /**
   * `true` for the one status that is the **coach's** own queue. Renders
   * `DESIGN.md` §4's selection pill — §2's "this one is different" without
   * colour-coding it, the same move `DashboardCounters` makes with
   * `elevation="tinted"` on the selected counter.
   */
  emphasised: boolean;
}

/**
 * The four statuses, as words and as one bit of emphasis.
 *
 * **Neither half is invented here.**
 *
 * The emphasis split is `apps/api/src/features/coach/dashboard.ts`'s,
 * already shipped: `needsReviewQuery` counts `status = 'submitted'`
 * check-ins into the dashboard's **Needs review** counter, and
 * `checkinsDueQuery` counts `status = 'pending'` ones into **Check-ins
 * due** — with that file's own comment spelling out why they can never
 * count the same row ("a submitted check-in is the coach's work"). Neither
 * counter takes `reviewed` or `missed`. So: one status is the coach's
 * queue, three are not, and this table is that fact rendered rather than a
 * second opinion about it.
 *
 * The words are those two counters' own labels, narrowed to the tab they
 * are already inside — `DashboardCounters`'s `'Needs review'` verbatim, and
 * `'Check-ins due'` shortened to `'Due'`, because a row inside the
 * Check-ins tab does not need to say "check-ins" again.
 *
 * **No colour is decided here, and no third tone exists.** `DESIGN.md` §8
 * reserves the warmth ramp for adherence state, so a missed check-in is
 * never `colors.state.offPlan` and never `urgent` — enforced by the
 * `theme/adherence-colors-only` lint rule, which this file is deliberately
 * not on the allowlist for. Four words already separate four states; a
 * third fill would add a channel that says nothing the label does not.
 *
 * **`'Missed'` is the coach app's word, and the asymmetry is deliberate**
 * (`product-copy` §3): a coach is the qualified party and needs the closed
 * window to read differently from the open one at a glance. Softening it to
 * "not submitted" would make it indistinguishable from `pending`'s meaning,
 * which is the one distinction the row exists to draw. Nothing on the
 * client's side of the product ever renders this table.
 */
export const CHECKIN_STATUS_BADGE: Record<CheckinStatus, StatusBadge> = {
  pending: { label: 'Due', emphasised: false },
  submitted: { label: 'Needs review', emphasised: true },
  reviewed: { label: 'Reviewed', emphasised: false },
  missed: { label: 'Missed', emphasised: false },
};

const TITLE_LINE = fontSize.label[1].lineHeight; // '20px'
const META_LINE = fontSize.micro[1].lineHeight; // '15px'
const VERTICAL_PADDING = spacing(11);
const TITLE_META_GAP = spacing(3);
/** 1, not `hairlineWidth` — the same reasoning, and the same value, as `ClientRow`'s. */
const DIVIDER = 1;

function px(value: string): number {
  return Number.parseInt(value, 10);
}

/**
 * **The measured row height, and the row's own `minHeight`.**
 *
 * ```
 *   11  paddingTop
 * + 20  period      — `label`, lineHeight 20
 * +  3  gap
 * + 15  meta        — `micro`, lineHeight 15
 * + 11  paddingBottom
 * +  1  divider
 * = 61
 * ```
 *
 * Identical arithmetic to `CLIENT_ROW_HEIGHT`, read from the same
 * `fontSize` table rather than written as a literal, so a change to the
 * type scale moves this number with it. The 33px `Chip` and the 15px
 * chevron both sit inside the 38px text block, so neither sets the height.
 *
 * This is what `CLAUDE.md` §25.8 is actually asking for. FlashList v2 has
 * no `estimatedItemSize` — the prop was deleted with v2's recycler rewrite,
 * which measures rows itself — so the number lives on the row instead of on
 * the list, and its job is to make every row report a stable, uniform size
 * on first layout rather than settle over several frames.
 *
 * `minHeight`, never `height`: at 200% text both lines grow and a fixed row
 * would clip them (`accessibility` §3).
 */
export const CHECKIN_ROW_HEIGHT =
  VERTICAL_PADDING * 2 + px(TITLE_LINE) + TITLE_META_GAP + px(META_LINE) + DIVIDER;

export interface ClientCheckinsRowProps {
  checkin: ClientCheckin;
  /** The signed-in coach's own zone, resolved once by the screen (`lib/time-zone`). */
  timeZone: string;
  /** Takes the id, never a closure over the row — a new arrow per row defeats `memo`. */
  onPress: (checkinId: string) => void;
  testID?: string;
}

/**
 * `React.memo` for the same reason `ClientRow` has it: a weekly client
 * accumulates 52 rows a year and the list re-renders whenever the query
 * revalidates behind it (`frontend-performance` §3).
 */
export const ClientCheckinsRow = memo(function ClientCheckinsRow({
  checkin,
  timeZone,
  onPress,
  testID,
}: ClientCheckinsRowProps) {
  const themed = useThemedStyles();
  const chevronColor = useChevronColor();
  const badge = CHECKIN_STATUS_BADGE[checkin.status];
  const period = formatCheckinPeriod(checkin.periodStart, checkin.periodEnd);
  const detail = describeCheckinRow(checkin, timeZone);

  return (
    <Pressable
      onPress={() => {
        onPress(checkin.checkinId);
      }}
      accessibilityRole="button"
      // One sentence per row, not four fragments — and the status arrives
      // as a WORD, which is what makes the list readable with no colour
      // vision at all (`accessibility` §2, §4). Same contract `ClientRow`
      // keeps on the dashboard.
      accessibilityLabel={buildRowLabel(checkin, detail, badge.label)}
      style={[styles.row, themed.divider]}
      testID={testID ?? `client-checkin-${checkin.checkinId}`}
    >
      <View style={styles.text}>
        <Text size="label" numberOfLines={1}>
          {period}
        </Text>
        <Text size="micro" tone="muted" numberOfLines={1} style={styles.meta}>
          {detail}
        </Text>
      </View>

      {/* Hidden from the reading order: the row's own label already says
          the status in words, and `Chip`'s tag form is an accessible
          element in its own right — two focusable fragments per row is the
          failure `AdherenceDot`'s contract warns about, and the one
          `ClientRow` hides its dot lane to avoid. */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Chip label={badge.label} selected={badge.emphasised} density="coach" />
      </View>

      {/* `fg.faint` never carries meaning (`DESIGN.md` §13) — the chevron
          says "this opens", which the row's `button` role already says. */}
      <ChevronRight size={15} color={chevronColor} />
    </Pressable>
  );
});

/**
 * `'8 – 14 Sep'`, collapsing the month when the period does not cross one.
 *
 * Pinned to UTC, and that is not a shortcut: `period_start` and
 * `period_end` are `date` columns — a calendar day, not an instant
 * (`code-conventions` §6). Reading them in a zone west of UTC would render
 * 14 September as the 13th, which is the single most common date bug in
 * this product (`CLAUDE.md` §25.5). `ClientOverviewScreen` pins its own
 * check-in dates the same way and for the same reason; the two are not
 * shared because importing across screen modules to reach a formatter
 * would pull the whole Overview module graph — `WeightTrendChart`, and
 * Skia behind it — into this row's bundle. On a third consumer it moves to
 * `packages/utils`.
 */
export function formatCheckinPeriod(periodStartISO: string, periodEndISO: string): string {
  const start = calendarDate(periodStartISO);
  const end = calendarDate(periodEndISO);
  const sameMonth =
    formatLocalDate(start, 'UTC', 'yyyy-MM') === formatLocalDate(end, 'UTC', 'yyyy-MM');

  return `${formatLocalDate(start, 'UTC', sameMonth ? 'd' : 'd MMM')} – ${formatLocalDate(end, 'UTC', 'd MMM')}`;
}

/**
 * The one date that matters for the state the row is in — facts, never a
 * verdict (`product-copy` §1). "Overdue" would be a judgement about a
 * person, which is why `ClientOverviewScreen.describeCheckin` refuses it
 * too.
 *
 * `submittedAt` and `reviewedAt` are real instants, so they are rendered in
 * the signed-in coach's stored zone rather than UTC: "when did this land
 * for me" is a question about the reader's own day.
 */
export function describeCheckinRow(checkin: ClientCheckin, timeZone: string): string {
  switch (checkin.status) {
    case 'pending':
      return `Due ${formatLocalDate(calendarDate(checkin.periodEnd), 'UTC', 'd MMM')}`;
    case 'submitted':
      return withInstant('Submitted', checkin.submittedAt, timeZone);
    case 'reviewed':
      return withInstant('Reviewed', checkin.reviewedAt, timeZone);
    case 'missed':
      return 'Nothing submitted';
  }
}

/**
 * Both columns are nullable, so a row can legitimately arrive without the
 * instant its status implies. The word alone is still true; a fabricated
 * date would not be.
 */
function withInstant(word: string, instant: Date | null, timeZone: string): string {
  return instant === null ? word : `${word} ${formatLocalDate(instant, timeZone, 'd MMM')}`;
}

function buildRowLabel(checkin: ClientCheckin, detail: string, status: string): string {
  const spokenPeriod = `${formatLocalDate(calendarDate(checkin.periodStart), 'UTC', 'd MMMM')} to ${formatLocalDate(calendarDate(checkin.periodEnd), 'UTC', 'd MMMM')}`;

  return `Check-in, ${spokenPeriod}. ${detail}. ${status}.`;
}

/** A `yyyy-MM-dd` column read as the instant that is midnight UTC on that day. */
function calendarDate(dateISO: string): Date {
  return new Date(`${dateISO}T00:00:00Z`);
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(11),
    minHeight: CHECKIN_ROW_HEIGHT,
    paddingVertical: VERTICAL_PADDING,
    borderBottomWidth: DIVIDER,
  },
  text: { flex: 1, minWidth: 0 },
  meta: { marginTop: TITLE_META_GAP },
});

const useThemedStyles = createThemedStyles((t) => ({
  divider: { borderBottomColor: t.colors.border.soft },
}));

const useChevronColor = createThemedValue((t) => t.colors.fg.faint);
