import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { density as densityTokens, spacing, type Density, type TextSize } from '../theme/tokens.ts';

import { Button } from './Button.tsx';
import { Text } from './Text.tsx';

export interface EmptyStateAction {
  label: string;
  onPress: () => void;
}

export interface EmptyStateProps {
  /**
   * `DESIGN.md` §6 allows the isometric solid in exactly two empty states
   * (Progress → Photos, inbox-clear), so most empty states have no
   * illustration at all — hence optional, and hidden from the reading order
   * wherever it is supplied.
   */
  icon?: ReactNode;
  title: string;
  /** §9's "explanation": the privacy note or the next step. */
  body?: string | undefined;
  /**
   * Exactly one action, never an array and never optional — `CLAUDE.md`
   * §7.5's rule ("one clear primary action") enforced at the type level, so
   * a later feature phase cannot quietly ship an empty state with two
   * competing next steps or none at all.
   */
  primaryAction: EmptyStateAction;
  density?: Density;
  testID?: string | undefined;
}

// `DESIGN.md` §9 caps the explanation at ≤280px; the coach prototype's own
// empty state (`CoachOS-Coach.dc.html`, inbox-clear) draws it at 270. A
// measure, not a spacing step.
const BODY_MAX_WIDTH = 270;

// §1.3's body floor per density. The explanation is the only text here that
// moves with density — §9 gives the heading one size, not a pair.
const BODY_SIZE: Record<Density, TextSize> = { client: 'body-lg', coach: 'body' };

/**
 * The designed replacement for a blank screen: illustration, one line, one
 * explanation, one action (`DESIGN.md` §9, `ui-conventions` §4).
 *
 * Every value is a literal from `CoachOS-Coach.dc.html`'s inbox-clear state
 * — 52/20 padding, 12px under the illustration, 6px under the heading, a
 * 270px measure — and this file names no colour of its own, so it is
 * correct in both schemes by construction: `Text` carries the scheme
 * through its `className`, `Button` carries its own fill.
 *
 * There is no `variant` prop on the action and no secondary slot. Both
 * exist to be asked for and both defeat the rule the singular
 * `primaryAction` is here to keep (`ui-conventions` §4).
 *
 * Copy is the consumer's (`COPY.md` §CO4.1): state the fact, offer one next
 * step, no apology and no exclamation mark. §9 — "explains privacy or next
 * step, never scolds."
 */
export function EmptyState({
  icon,
  title,
  body,
  primaryAction,
  density: densityProp = 'client',
  testID,
}: EmptyStateProps) {
  return (
    <View testID={testID} style={[styles.block, { gap: densityTokens[densityProp].sectionGap }]}>
      <View style={styles.copy}>
        {icon ? (
          <View
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {icon}
          </View>
        ) : null}
        <View style={styles.words}>
          {/* §9 asks for a 20px Space Grotesk line. The closed type scale
              (§1.2) has no 20px Space Grotesk step — `title` is 20/26 but
              Instrument Sans — so `h2` (21/25, Space Grotesk) is the step
              that keeps the face §9 and the prototype both draw. */}
          <Text size="h2" accessibilityRole="header" style={styles.centered}>
            {title}
          </Text>
          {body ? (
            <Text size={BODY_SIZE[densityProp]} tone="muted" style={styles.body}>
              {body}
            </Text>
          ) : null}
        </View>
      </View>
      {/* `Button`'s container is `alignSelf: 'flex-start'`, which beats this
          column's `alignItems: 'center'`. The wrapper hugs the button and is
          itself what gets centred. */}
      <View>
        <Button
          variant="primary"
          size="md"
          // §9 pins the empty state's action at one height — "one 52px
          // action" — where the same table gives the generic primary button
          // a 46–52 density pair. `density.client.button` IS that 52, and it
          // is also the only value that clears the 48×48 tap floor
          // (`accessibility` §1) in a coach-density screen.
          density="client"
          onPress={primaryAction.onPress}
          accessibilityLabel={primaryAction.label}
        >
          {primaryAction.label}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    alignItems: 'center',
    paddingVertical: spacing(52),
    paddingHorizontal: spacing(20),
  },
  copy: {
    alignItems: 'center',
    gap: spacing(12),
  },
  words: {
    alignItems: 'center',
    gap: spacing(6),
  },
  centered: {
    textAlign: 'center',
  },
  body: {
    textAlign: 'center',
    maxWidth: BODY_MAX_WIDTH,
  },
});
