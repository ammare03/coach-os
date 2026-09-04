import type { AdherenceState } from '@coachos/utils';
import { StyleSheet, View } from 'react-native';

import { spacing, tapTarget } from '../theme/tokens.ts';

import {
  ADHERENCE_DOT_DIAMETER,
  ADHERENCE_STATE_LABEL,
  AdherenceDot,
  type AdherenceDotSize,
} from './AdherenceDot.tsx';
import { Pressable } from './Pressable.tsx';
import { Text } from './Text.tsx';

/** The metric a strip describes. Label-only — it never changes the graphic. */
export type AdherenceMetric = 'training' | 'nutrition';

export interface AdherenceDay {
  /** A local calendar date, `yyyy-MM-dd` (`code-conventions` §6 — a training day is a date, not an instant). */
  dateISO: string;
  state: AdherenceState;
}

export interface AdherenceDotRowProps {
  /**
   * Whatever the caller has. Entries outside the seven-day window ending on
   * `todayISO` are ignored and missing days render `not started` — the row
   * is ALWAYS seven dots wide so two clients can be compared vertically
   * down a list.
   */
  days: AdherenceDay[];
  metric: AdherenceMetric;
  /** The client's local "today" (`yyyy-MM-dd`), which anchors the right-hand end. */
  todayISO: string;
  size?: AdherenceDotSize;
  /** Day letters above the dots. Off in a dense coach list row, on where there is room. */
  showDayLabels?: boolean;
  /** The whole row is the tap target — never the individual dots. */
  onPress?: () => void;
  testID?: string;
}

const DAYS_IN_WEEK = 7;
const DOT_GAP = spacing(6);
const LABEL_GAP = spacing(9);

// Sunday-first, matching `Date.prototype.getUTCDay()`. English only, as the
// prototypes are; localisation is an open decision (`CLAUDE.md` §27) and a
// half-done one here would be worse than none.
const WEEKDAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

/**
 * The seven calendar dates ending on `todayISO`, oldest first — a week reads
 * left to right, and the newest day is where the coach's eye should land.
 *
 * Pure calendar arithmetic in UTC, deliberately: a `yyyy-MM-dd` is already
 * resolved to the user's local day upstream, so re-applying a timezone here
 * would shift it a second time (`code-conventions` §6).
 */
function weekEndingOn(todayISO: string): string[] {
  if (!CALENDAR_DATE.test(todayISO)) {
    throw new Error(
      `AdherenceDotRow: todayISO must be a yyyy-MM-dd calendar date, got "${todayISO}".`,
    );
  }
  const end = Date.parse(`${todayISO}T00:00:00.000Z`);
  if (Number.isNaN(end)) {
    throw new Error(`AdherenceDotRow: "${todayISO}" is not a real calendar date.`);
  }
  return Array.from({ length: DAYS_IN_WEEK }, (_, index) =>
    new Date(end - (DAYS_IN_WEEK - 1 - index) * MS_PER_DAY).toISOString().slice(0, 10),
  );
}

/**
 * "Training this week: 4 on plan, 2 drifting, 1 not started."
 *
 * One sentence per row, not seven announcements: a screen-reader user
 * swiping thirty client rows must not have to traverse two hundred and ten
 * dots to learn the same thing a sighted coach learns in a glance. States
 * are listed best-to-worst and zero counts are omitted, so a fully logged
 * week is four words long.
 */
function weekSummary(states: AdherenceState[], metric: AdherenceMetric): string {
  const order: AdherenceState[] = ['on-track', 'drifting', 'off-track', 'no-data'];
  const parts = order
    .map((state) => ({ state, count: states.filter((each) => each === state).length }))
    .filter(({ count }) => count > 0)
    .map(({ state, count }) => `${count} ${ADHERENCE_STATE_LABEL[state].toLowerCase()}`);

  const noun = metric === 'training' ? 'Training' : 'Nutrition';
  return `${noun} this week: ${parts.join(', ')}`;
}

/**
 * The seven-day adherence strip that sits on every client row.
 *
 * Ordered oldest to newest with today at the right end, always exactly seven
 * dots wide, and padded with `not started` rather than collapsed — a coach
 * comparing two clients reads down a column, which only works if every row
 * has the same shape. A client who has logged nothing shows seven dashed
 * grey dots and never a row of red (`DESIGN.md` §10.5).
 *
 * The strip carries one accessible summary and hides its dots from the
 * reading order. Where it is interactive, the whole row is the target.
 */
export function AdherenceDotRow({
  days,
  metric,
  todayISO,
  size = 'sm',
  showDayLabels = false,
  onPress,
  testID,
}: AdherenceDotRowProps) {
  const weekDates = weekEndingOn(todayISO);
  const byDate = new Map(days.map((day) => [day.dateISO, day.state]));
  const resolved = weekDates.map((dateISO) => ({
    dateISO,
    state: byDate.get(dateISO) ?? ('no-data' as AdherenceState),
    isToday: dateISO === todayISO,
  }));

  const strip = (
    <View
      style={styles.strip}
      // One accessible node for the week; the dots inside are decorative
      // once the summary above exists (`accessibility` §2).
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {resolved.map((day) => (
        <View key={day.dateISO} style={[styles.column, { minWidth: ADHERENCE_DOT_DIAMETER[size] }]}>
          {showDayLabels ? (
            // Today is marked by BRIGHTENING its letter, the way every
            // prototype marks the current/latest item — never by changing
            // the dot, which already carries the state and nothing else.
            //
            // `muted`, not `subtle`: the prototypes draw these letters in
            // `#6B7689` at 11px, which `DESIGN.md` §13 permits only at
            // >=14px. §13 wins — the letter identifies its column, so it
            // carries meaning and has to clear the contrast floor.
            <Text size="micro" tone={day.isToday ? 'default' : 'muted'}>
              {WEEKDAY_LETTER[new Date(`${day.dateISO}T00:00:00.000Z`).getUTCDay()]}
            </Text>
          ) : null}
          <AdherenceDot state={day.state} size={size} />
        </View>
      ))}
    </View>
  );

  const summary = weekSummary(
    resolved.map((day) => day.state),
    metric,
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={summary}
        testID={testID}
        style={styles.target}
      >
        {strip}
      </Pressable>
    );
  }

  return (
    <View accessible accessibilityLabel={summary} testID={testID}>
      {strip}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: DOT_GAP,
  },
  column: {
    alignItems: 'center',
    gap: LABEL_GAP,
  },
  // `minHeight`, never `height` — the row grows at 200% text size rather
  // than clipping its day letters (`accessibility` §3).
  target: {
    minHeight: tapTarget.MIN,
    justifyContent: 'center',
  },
});
