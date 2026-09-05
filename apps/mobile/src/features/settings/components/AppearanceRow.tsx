// `/design` round 1's Option B included this row for context (a settings
// screen with only one row looks unfinished); kept on request. Static —
// there is no theme-preference column or store anywhere in this codebase
// yet (grep confirms it), so this renders "System" and does nothing on
// press. Wiring a real light/dark override is its own task, not this one.
import { createThemedStyles, spacing, useTheme } from '@coachos/ui';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

function ChevronRight({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 18l6-6-6-6"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function AppearanceRow() {
  const theme = useTheme();
  const themed = useThemedStyles();

  return (
    <View
      style={[layout.row, themed.row]}
      accessibilityRole="text"
      accessibilityLabel="Appearance, System — not yet available"
    >
      <Text style={[layout.label, themed.label]}>Appearance</Text>
      <View style={layout.trailing}>
        <Text style={[layout.value, themed.value]}>System</Text>
        <ChevronRight color={theme.colors.fg.muted} />
      </View>
    </View>
  );
}

// Scheme-invariant geometry at module scope, colour through the hook —
// reading `colors` at module scope bakes the dark table in at import and
// the row can never follow a scheme change (`createThemedStyles`' contract).
const layout = StyleSheet.create({
  row: {
    minHeight: 72,
    paddingHorizontal: spacing(16),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    borderWidth: 1,
  },
  label: {
    fontFamily: 'System',
    fontSize: 16,
    lineHeight: 24,
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(8),
  },
  // 12px, so `fg.subtle` is out — DESIGN.md §13 restricts it to ≥14px, and
  // on a raised card it measures 2.90:1. `fg.muted` is 6.41:1.
  value: {
    fontFamily: 'System',
    fontSize: 12,
    lineHeight: 16,
  },
});

const useThemedStyles = createThemedStyles((theme) => ({
  row: {
    backgroundColor: theme.colors.bg.raised,
    borderColor: theme.colors.border.soft,
  },
  label: { color: theme.colors.fg.DEFAULT },
  value: { color: theme.colors.fg.muted },
}));
