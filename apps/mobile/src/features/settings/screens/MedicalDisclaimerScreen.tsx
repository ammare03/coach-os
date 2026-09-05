// `phase-06-onboarding/onboarding-infrastructure/03` — the settings half of
// §21.3's requirement ("a standing disclaimer appears at onboarding and in
// settings"). Pattern F, detail read (`UI-UX.md` §UX2): a Liquid Glass nav
// bar over the words, and nothing to do.
//
// The disclaimer itself never depends on a query — it is a constant in
// `@coachos/ui`, so this screen has no loading, empty, or error state for
// the thing a person came here to read (`UI-UX.md` §UX4's error-isolation
// rule). Only the one supplementary line at the foot, "you acknowledged
// this on …", comes from the server, and its absence is silence rather
// than an error banner.
import { GlassSurface, MedicalDisclaimer, Pressable, spacing, useTheme } from '@coachos/ui';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { useMedicalDisclaimer } from '../hooks/useMedicalDisclaimer.ts';

export interface MedicalDisclaimerScreenProps {
  onBack: () => void;
}

const NAV_BAR_HEIGHT = 56;

function BackChevron({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M15 5l-7 7 7 7"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * The user's own locale, day-month-year. Not `date-fns` — it is not a
 * dependency of `apps/mobile` — and not a day-boundary computation either:
 * this is the instant an acknowledgment was recorded, rendered for a human,
 * not a training day (`code-conventions` §6 governs the latter, not this).
 */
function formatAcknowledgedOn(at: Date): string {
  return at.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function MedicalDisclaimerScreen({ onBack }: MedicalDisclaimerScreenProps) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { status } = useMedicalDisclaimer();
  const acknowledgedAt = status.data?.acknowledgedAt ?? null;

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.bg.DEFAULT }]}>
      <GlassSurface
        tier="tier1"
        style={[styles.navBar, { paddingTop: insets.top, height: NAV_BAR_HEIGHT + insets.top }]}
      >
        <View style={styles.navBarContent}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={12}
            style={styles.backButton}
          >
            <BackChevron color={theme.colors.fg.DEFAULT} />
          </Pressable>
          <Text style={[styles.navTitle, { color: theme.colors.fg.DEFAULT }]}>
            Medical disclaimer
          </Text>
        </View>
      </GlassSurface>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: NAV_BAR_HEIGHT + insets.top + spacing(20),
            paddingBottom: 28 + insets.bottom,
          },
        ]}
      >
        <MedicalDisclaimer
          variant="settings"
          acknowledgedOn={acknowledgedAt ? formatAcknowledgedOn(acknowledgedAt) : undefined}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  navBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    justifyContent: 'flex-end',
  },
  navBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(12),
    paddingHorizontal: spacing(20),
    paddingBottom: spacing(12),
  },
  backButton: { minWidth: 48, minHeight: 48, alignItems: 'flex-start', justifyContent: 'center' },
  navTitle: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
  content: { paddingHorizontal: spacing(20) },
});
