import { Card, Text, createThemedValue, spacing } from '@coachos/ui';
import { ShieldAlert } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import type { ClientInjury } from '../api.ts';

// §8.3's injuries banner. Present if and only if `client_profiles.injuries`
// is non-empty — not a collapsed card, not an "no injuries recorded" empty
// state, simply absent (the phase README's acceptance criterion, verbatim).
//
// **The one surface on Overview drawn as an INSET well rather than a raised
// card**, and that is the whole design argument. §7.2's semantic-colour rule
// reserves the warmth ramp for adherence, so this cannot borrow `urgent` or
// `state.offPlan` to say "read me" — red beside a client's name means off
// plan, and a shoulder that has been managed for a year is not an adherence
// failure. Recession does the separating instead: every other block on the
// screen is L2 and rises, this one is L1 and sinks, and it is the only one.
//
// The words are the client's own record, relayed. Nothing here interprets a
// severity, ranks two injuries, or says what to train around — that is the
// coach's judgement and the product has none of its own (`product-copy` §1).

export interface InjuriesBannerProps {
  injuries: readonly ClientInjury[];
  testID?: string;
}

export function InjuriesBanner({ injuries, testID }: InjuriesBannerProps) {
  const iconColor = useIconColor();

  // Absent, not empty. Rendering a header over nothing would reserve a box
  // on every client who has never been hurt, and a reserved box for alarming
  // information is a small flash of alarm on every open.
  if (injuries.length === 0) {
    return null;
  }

  return (
    <Card elevation="inset" density="coach" testID={testID ?? 'injuries-banner'}>
      {/* One accessible item, one sentence — the same grouping rule the
          client row follows, for the same reason: four fragments per injury
          is noise in the reading order (`accessibility` §2). The grouping
          lives on this View rather than on `Card`, which sets
          `accessible={false}` on its own container by contract. */}
      <View style={styles.row} accessible accessibilityLabel={buildBannerLabel(injuries)}>
        <ShieldAlert size={18} color={iconColor} style={styles.icon} />

        <View style={styles.body}>
          <Text size="eyebrow" tone="warm-muted">
            INJURIES ON FILE
          </Text>

          {injuries.map((injury, index) => (
            <View
              key={`${injury.area}-${String(index)}`}
              style={index === 0 ? styles.firstInjury : styles.injury}
            >
              <Text size="body-sm">{describeInjury(injury)}</Text>
              {injury.notes === null ? null : (
                <Text size="body-sm" tone="muted" style={styles.notes}>
                  {injury.notes}
                </Text>
              )}
            </View>
          ))}
        </View>
      </View>
    </Card>
  );
}

/**
 * "Left knee · moderate · since 2025-11" — the three stored facts, joined,
 * with nothing added. `since` is relayed exactly as recorded rather than
 * parsed: the column is free text (`"2025-11"`, `"Jan 2026"`, `"school"`),
 * and a date parser over it would render a confident wrong month
 * (`code-conventions` §6).
 */
export function describeInjury(injury: ClientInjury): string {
  const parts = [injury.area];
  if (injury.severity !== null) parts.push(injury.severity);
  if (injury.since !== null) parts.push(`since ${injury.since}`);
  return parts.join(' · ');
}

function buildBannerLabel(injuries: readonly ClientInjury[]): string {
  const spoken = injuries.map((injury) => {
    const head = describeInjury(injury).replaceAll(' · ', ', ');
    return injury.notes === null ? `${head}.` : `${head}. ${injury.notes}`;
  });
  return `Injuries on file. ${spoken.join(' ')}`;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing(11) },
  // Optically aligned to the eyebrow's cap height rather than its box.
  icon: { marginTop: spacing(3) },
  body: { flex: 1, minWidth: 0 },
  firstInjury: { marginTop: spacing(5) },
  injury: { marginTop: spacing(9) },
  notes: { marginTop: spacing(3) },
});

const useIconColor = createThemedValue((t) => t.colors.fg['warm-muted']);
