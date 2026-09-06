import { Card, createThemedStyles, radius, spacing, Text } from '@coachos/ui';
import { StyleSheet, View } from 'react-native';

// The client flow's single-select row: a full-width, thumb-sized card with
// a radio mark, used by goals (`client-onboarding/02`) and experience level
// (`client-onboarding/03`).
//
// A card rather than a `Select` or a picker wheel, because §1.3's client
// density is a one-thumb, gym-floor decision and the whole option set has
// to be readable in one look. `SegmentedControl` is capped at four options
// by type and is the wrong shape for five with subtitles; `Chip` is a
// multi-select. This is the gap between them.
//
// It lives in the feature rather than `packages/ui` because it has two
// consumers in one flow. Promote it if a third arrives outside onboarding.

export interface OptionCardProps {
  label: string;
  /** Optional second line — the thing that makes an option pickable without guessing. */
  description?: string | undefined;
  selected: boolean;
  onPress: () => void;
}

const MARK_SIZE = 22;

export function OptionCard({ label, description, selected, onPress }: OptionCardProps) {
  const themed = useThemedStyles();

  return (
    <Card
      elevation={selected ? 'tinted' : 'raised'}
      onPress={onPress}
      accessibilityLabel={description === undefined ? label : `${label}. ${description}`}
    >
      <View style={styles.row}>
        <View style={[styles.mark, selected ? themed.markOn : themed.markOff]} />
        <View style={styles.text}>
          <Text size="body-lg">{label}</Text>
          {description === undefined ? null : (
            <Text size="body-sm" tone="muted" style={styles.description}>
              {description}
            </Text>
          )}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing(13) },
  text: { flex: 1 },
  description: { marginTop: spacing(3) },
  mark: {
    width: MARK_SIZE,
    height: MARK_SIZE,
    borderRadius: radius.full,
  },
});

const useThemedStyles = createThemedStyles((theme) => ({
  markOff: { borderWidth: 1.5, borderColor: theme.colors.border.strong },
  // A thick brand ring over the canvas reads as "filled" without a second
  // nested view, and keeps the whole mark one element for the screen reader.
  markOn: { borderWidth: 6, borderColor: theme.colors.brand.DEFAULT },
}));
