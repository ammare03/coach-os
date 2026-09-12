import { ADHERENCE_STATE_LABEL, Card, Metric, Text, spacing, tapTarget } from '@coachos/ui';
import { StyleSheet, View } from 'react-native';

// §8.2's three counters, above the client list. Each is a tap target that
// narrows the list below it — this task wires the target and the selected
// state; `coach-dashboard/02` owns what the filter actually does with it.

/**
 * The three, in the order §8.2 names them. A key rather than a label so the
 * selection can be stored, compared, and handed to `coach-dashboard/02`
 * without anyone parsing display copy.
 */
export type DashboardCounterKey = 'needsReview' | 'offPlan' | 'checkinsDue';

/**
 * The middle card borrows `ADHERENCE_STATE_LABEL`'s word rather than §8.2's
 * "off track". The counter's value is exactly the clients whose dot reads
 * "Off plan" (`getCoachDashboard` filters on `adherenceColor === 'red'`),
 * and a card saying one thing while every dot beside a name says another is
 * the drift that label exists to prevent.
 */
const COUNTER_LABEL: Record<DashboardCounterKey, string> = {
  needsReview: 'Needs review',
  offPlan: ADHERENCE_STATE_LABEL['off-track'],
  checkinsDue: 'Check-ins due',
};

const COUNTER_ORDER: readonly DashboardCounterKey[] = ['needsReview', 'offPlan', 'checkinsDue'];

export interface DashboardCounterValues {
  needsReview: number;
  offPlan: number;
  checkinsDue: number;
}

export interface DashboardCountersProps {
  values: DashboardCounterValues;
  /** `null` is "no counter selected" — the whole list, which is the default view. */
  selected: DashboardCounterKey | null;
  /** Tapping the selected counter clears it; the caller receives the key either way. */
  onSelect: (counter: DashboardCounterKey) => void;
  testID?: string;
}

/**
 * Three cards, three tap targets.
 *
 * A zero counter renders `muted`, never `urgent` — nothing needing review is
 * the good outcome, and a red 0 would put the one colour §8 reserves for a
 * failing client on an empty queue (`ui-conventions` §2).
 */
export function DashboardCounters({ values, selected, onSelect, testID }: DashboardCountersProps) {
  return (
    <View style={styles.row} testID={testID}>
      {COUNTER_ORDER.map((key) => (
        <CounterCard
          key={key}
          counter={key}
          value={values[key]}
          isSelected={selected === key}
          onSelect={onSelect}
        />
      ))}
    </View>
  );
}

interface CounterCardProps {
  counter: DashboardCounterKey;
  value: number;
  isSelected: boolean;
  onSelect: (counter: DashboardCounterKey) => void;
}

function CounterCard({ counter, value, isSelected, onSelect }: CounterCardProps) {
  const label = COUNTER_LABEL[counter];

  return (
    <View style={styles.cell}>
      <Card
        // L3 is DESIGN.md §2's "this one is different" without colour-coding
        // it — which is what a selected filter is.
        elevation={isSelected ? 'tinted' : 'raised'}
        density="coach"
        onPress={() => {
          onSelect(counter);
        }}
        accessibilityLabel={`${label}, ${String(value)}`}
        testID={`dashboard-counter-${counter}`}
      >
        <View style={styles.body}>
          <Text size="eyebrow" tone={isSelected ? 'warm' : 'muted'} numberOfLines={2}>
            {label.toUpperCase()}
          </Text>
          <View style={styles.value}>
            <Metric value={value} size="stat" tone={value === 0 ? 'muted' : 'default'} />
          </View>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing(9) },
  cell: { flex: 1, minWidth: 0 },
  // `minHeight`, never `height` — the label wraps to two lines at 200% text
  // and a fixed box would clip it (`accessibility` §3).
  body: { minHeight: tapTarget.MIN, justifyContent: 'space-between' },
  value: { marginTop: spacing(4) },
});
