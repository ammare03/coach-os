import { Button, Card, ListRow, ListSection, Text, spacing, type Density } from '@coachos/ui';
import { useRouter } from 'expo-router';
import { Eye } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { coachFirstName } from '../../onboarding/components/SharingControls.tsx';
import { HISTORY_SHARING_COPY } from '../screens/HistorySharingScreen.tsx';

import { LeaveCoachRow } from './LeaveCoachRow.tsx';

// `relationship-controls/02`. Design: `leave-coach.html`, frames A, B, G.
//
// The **Coaching** section, and the only place it exists. Three rules:
//
// 1. **Slot order is the contract.** The section map puts
//    *What {coach} can see* above *Leave coach*, and that is not arbitrary:
//    the benign, reversible, navigating row comes first, so a thumb
//    travelling down the list meets the safe control before the
//    irreversible one. Task 03 inserts its `ListRow` at the marked slot
//    below and touches nothing else — not `SettingsScreen.tsx`, and never a
//    second section.
//
// 2. **The coach resolves once, here.** Both rows take the same object, so
//    neither runs a query of its own (`screen-composition` §2: no query
//    inside a list row).
//
// 3. **Nothing is drawn until the coach is known.** Not a skeleton row — a
//    skeleton that resolves to an empty state is a row that was never
//    there, and on a settings list that reads as something having just been
//    taken away. Every other section paints immediately; this one arrives.

/**
 * `COPY.md` §CO4.1 — the fact, then one next step. No apology, no "yet",
 * and nothing that frames the state as a loss. Module constants rather than
 * JSX text so the strings are one line each, greppable, and ready to
 * extract for localisation (`product-copy` §6).
 */
const NO_COACH_TITLE = "You're not currently working with a coach";
const NO_COACH_BODY =
  "Everything you've logged is still yours. Enter an invite code to work with a new coach.";
const NO_COACH_ACTION = 'Enter an invite code';
/**
 * The label says what the action is about, not where it goes — which is
 * exactly the gap a hint fills (`accessibility` §2). Not a restatement of
 * the label, and not read at all by a sighted user.
 */
const NO_COACH_ACTION_HINT = "Opens the screen where you enter a coach's invite code";

export interface CoachingSectionProps {
  /** `null` = coachless, which is a real state and not an error. Drives the whole branch. */
  coach: { id: string; name: string } | null;
  /** True until the answer is known — including a read that failed, which is not "no coach". */
  isLoading?: boolean;
  density?: Density;
}

export function CoachingSection({ coach, isLoading = false, density }: CoachingSectionProps) {
  const router = useRouter();

  if (isLoading) {
    return null;
  }

  if (coach === null) {
    return (
      // `grouped={false}`: the empty state is a card in its own right, and
      // `DESIGN.md` §2 forbids a card inside a card at the same level.
      <ListSection title="Coaching" grouped={false} {...(density ? { density } : {})}>
        <NoCoachState {...(density ? { density } : {})} />
      </ListSection>
    );
  }

  return (
    <ListSection title="Coaching" {...(density ? { density } : {})}>
      {/*
        SLOT 1 — `relationship-controls/03`'s **What {coach} can see**. The
        FIRST child, above Leave coach: rule 1 above, and the first name
        rather than the full one because the screen it opens is a sentence
        about a person ("What Arjun can see"), not a record.

        It takes the `coach` this section already resolved and runs no
        query of its own (rule 2), and it navigates — so `ListRow` draws
        the chevron, unlike the destructive row beneath it.
      */}
      <ListRow
        label={HISTORY_SHARING_COPY.rowLabel(coachFirstName(coach.name))}
        description={HISTORY_SHARING_COPY.rowDescription}
        icon={Eye}
        accessibilityHint={HISTORY_SHARING_COPY.rowHint}
        onPress={() => router.push('/(client)/settings/sharing')}
        testID="settings-history-sharing"
        {...(density ? { density } : {})}
      />
      <LeaveCoachRow coach={coach} {...(density ? { density } : {})} />
    </ListSection>
  );
}

/**
 * Deliberately **not** `EmptyState`. That component is full-screen and
 * measures 304px inside this section, which pushes **Delete account** below
 * the fold — and `CLAUDE.md` §21.4 puts deletion ≤3 taps from settings.
 * Built at section scale (210px) instead, which keeps the one-action rule
 * by construction rather than by convention.
 */
function NoCoachState({ density }: { density?: Density }) {
  const router = useRouter();

  return (
    <Card elevation="raised" {...(density ? { density } : {})}>
      <View style={styles.block}>
        <View style={styles.copy}>
          <Text size="h2" accessibilityRole="header">
            {NO_COACH_TITLE}
          </Text>
          <Text size="body-lg" tone="muted">
            {NO_COACH_BODY}
          </Text>
        </View>
        <View style={styles.action}>
          <Button
            variant="primary"
            accessibilityHint={NO_COACH_ACTION_HINT}
            onPress={() =>
              // The one signed-in way into the invite flow
              // (`client-onboarding/01`); `(auth)/invite/[code]` is
              // `AuthGate`'s single exemption for an authenticated caller,
              // and its route file already defends a missing code.
              router.push({ pathname: '/(auth)/invite/[code]', params: { code: '' } })
            }
            testID="settings-enter-invite-code"
          >
            {NO_COACH_ACTION}
          </Button>
        </View>
      </View>
    </Card>
  );
}

// Scheme-invariant geometry only — every colour comes through `Card`,
// `Text`'s tone, and `Button` (`createThemedStyles`' contract).
const styles = StyleSheet.create({
  block: {
    gap: spacing(18),
  },
  copy: {
    gap: spacing(6),
  },
  action: {
    // The button hugs its label rather than stretching: a full-width
    // primary in a settings list reads as the section's own submit.
    alignSelf: 'flex-start',
  },
});
