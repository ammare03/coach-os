// `/design` round 1's Option B included this row for context (a settings
// screen with only one row looks unfinished); kept on request. Static —
// there is no theme-preference column or store anywhere in this codebase
// yet (grep confirms it), so this renders "System" and does nothing on
// press. Wiring a real light/dark override is its own task, not this one.
import { colors, spacing } from '@coachos/ui';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

function ChevronRight() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 18l6-6-6-6"
        stroke={colors.fg.subtle}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function AppearanceRow() {
  return (
    <View
      style={styles.row}
      accessibilityRole="text"
      accessibilityLabel="Appearance, System — not yet available"
    >
      <Text style={styles.label}>Appearance</Text>
      <View style={styles.trailing}>
        <Text style={styles.value}>System</Text>
        <ChevronRight />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 72,
    paddingHorizontal: spacing(4),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bg.raised,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border.soft,
  },
  label: {
    fontFamily: 'System',
    fontSize: 16,
    lineHeight: 24,
    color: colors.fg.DEFAULT,
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
  },
  value: {
    fontFamily: 'System',
    fontSize: 12,
    lineHeight: 16,
    color: colors.fg.subtle,
  },
});
