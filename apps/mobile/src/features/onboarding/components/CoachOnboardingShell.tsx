import { Button, createThemedStyles, density, spacing, Text, useTheme } from '@coachos/ui';
import { ChevronLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StepProgress } from './StepProgress.tsx';

// `phase-06-onboarding/coach-onboarding/01` — the container every step in
// the flow renders inside.
//
// **Density is `client`, not `coach`, and that is deliberate.** This is a
// coach surface, so `DESIGN.md` §1.3 would ordinarily give it the 16px
// gutter and the 46px button. But the flow's first step is
// `MedicalDisclaimer`, which shipped in `onboarding-infrastructure/03` at
// client density (52px acknowledgment row, 20px gutter, 16pt body), and a
// four-step flow whose chrome resizes between step 1 and step 2 reads as a
// bug. Density in §1.3 is a working-surface decision — dense where a coach
// scans thirty rows — and this is a flow walked once, so the looser setting
// is also the right one on its own merits.
//
// No ambient layer (`DESIGN.md` §3). Nothing in the app renders one yet —
// `MedicalDisclaimerScreen`, which this flow must sit flush against, is a
// plain canvas — and inventing one here would make this flow the only
// screen in the product with a backdrop.

export interface CoachOnboardingShellAction {
  label: string;
  onPress: () => void;
  /** Inert until the step's required fields are valid. Never hidden — see the header comment. */
  disabled?: boolean;
  loading?: boolean;
}

export interface CoachOnboardingShellProps {
  /** 1-based, including the disclaimer gate at step 1. */
  step: number;
  totalSteps: number;
  title: string;
  subtitle: string;
  /** Omitted on the first step, which has nowhere inside the flow to go back to. */
  onBack?: (() => void) | undefined;
  /**
   * Omitted by a step that owns its own commit control — step 1 is the
   * disclaimer, whose Continue is inside `MedicalDisclaimer` because the
   * acknowledgment state that enables it is (`packages/ui`'s own contract).
   */
  primaryAction?: CoachOnboardingShellAction | undefined;
  secondaryAction?: CoachOnboardingShellAction | undefined;
  children: ReactNode;
}

const GUTTER = density.client.gutter;
const BACK_TARGET = 48;

export function CoachOnboardingShell({
  step,
  totalSteps,
  title,
  subtitle,
  onBack,
  primaryAction,
  secondaryAction,
  children,
}: CoachOnboardingShellProps) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const themed = useThemedStyles();

  return (
    <View style={[styles.screen, themed.screen]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + spacing(8), paddingBottom: spacing(26) + insets.bottom },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            {onBack ? (
              <Pressable
                onPress={onBack}
                accessibilityRole="button"
                accessibilityLabel="Back"
                style={styles.back}
              >
                <ChevronLeft size={22} color={theme.colors.fg.DEFAULT} />
              </Pressable>
            ) : null}
            <View style={styles.flex}>
              <StepProgress total={totalSteps} current={step} />
            </View>
          </View>

          <View style={styles.intro}>
            <Text size="h1-client" accessibilityRole="header">
              {title}
            </Text>
            <Text size="body" tone="muted" style={styles.subtitle}>
              {subtitle}
            </Text>
          </View>

          <View style={styles.body}>{children}</View>

          {primaryAction ? (
            <View style={styles.actions}>
              <Button
                onPress={primaryAction.onPress}
                disabled={primaryAction.disabled ?? false}
                loading={primaryAction.loading ?? false}
                fullWidth
                size="lg"
              >
                {primaryAction.label}
              </Button>
              {secondaryAction ? (
                <Button
                  variant="secondary"
                  onPress={secondaryAction.onPress}
                  disabled={secondaryAction.disabled ?? false}
                  loading={secondaryAction.loading ?? false}
                  fullWidth
                  size="lg"
                >
                  {secondaryAction.label}
                </Button>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1 },
  content: { paddingHorizontal: GUTTER, flexGrow: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing(12) },
  // The 22px glyph reaches §13's 44px floor by growing its own box to 48,
  // pulled back into the gutter so the progress row still starts at it.
  back: {
    width: BACK_TARGET,
    height: BACK_TARGET,
    marginLeft: -spacing(12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  intro: { marginTop: spacing(22) },
  subtitle: { marginTop: spacing(6) },
  body: { marginTop: spacing(24), flexGrow: 1 },
  actions: { marginTop: spacing(24), gap: spacing(10) },
});

const useThemedStyles = createThemedStyles((theme) => ({
  screen: { backgroundColor: theme.colors.bg.DEFAULT },
}));
