import { LinearGradient } from 'expo-linear-gradient';
import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '../components/Button.tsx';
import { Card } from '../components/Card.tsx';
import { Pressable } from '../components/Pressable.tsx';
import { Text } from '../components/Text.tsx';
import { createThemedStyles } from '../theme/createThemedStyles.ts';
import { radius, spacing, tapTarget, type Density, type TextSize } from '../theme/tokens.ts';
import { useTheme } from '../theme/useTheme.ts';

import { MEDICAL_DISCLAIMER_COPY } from './copy.ts';

export type MedicalDisclaimerVariant = 'onboarding' | 'settings';

interface MedicalDisclaimerBaseProps {
  density?: Density;
  testID?: string | undefined;
}

/**
 * A discriminated union rather than one shape with two optional halves
 * (`code-conventions` §3): `onAcknowledge` is REQUIRED on the onboarding
 * variant, so an onboarding disclaimer with no way forward is a compile
 * error, and `acknowledgedOn` cannot be passed to it at all.
 */
export type MedicalDisclaimerProps = MedicalDisclaimerBaseProps &
  (
    | {
        /** Adds the acknowledgment control and a Continue that stays disabled until it is given. */
        variant: 'onboarding';
        /**
         * Fires **only** after the acknowledgment is given — this component
         * is what makes "the flow cannot proceed unacknowledged" true, so a
         * caller has no unacknowledged path to wire by mistake.
         */
        onAcknowledge: () => void;
        /** True while the caller's write is in flight. */
        submitting?: boolean;
        acknowledgedOn?: never;
      }
    | {
        /** The same words with nothing to do — always readable, never asking again. */
        variant: 'settings';
        /**
         * Already formatted — a calendar date belongs to the user's own
         * timezone and `packages/ui` has no business computing one
         * (`code-conventions` §6). Absent when this user has not
         * acknowledged this wording, in which case nothing is shown rather
         * than "never".
         */
        acknowledgedOn?: string | undefined;
        onAcknowledge?: never;
        submitting?: never;
      }
  );

// §1.3's body floor per density, the same pair `EmptyState` uses.
const BODY_SIZE: Record<Density, TextSize> = { client: 'body-lg', coach: 'body' };

// §1.3's tap floor is 44; the acknowledgment row is the one decision on the
// onboarding screen and takes the 52px mid-set target plus its own padding.
const ACKNOWLEDGE_MIN_HEIGHT = tapTarget.MID_SET + spacing(8);

// The checkbox glyph. §9 pins no size for one; 26px matches the stepper's
// small-control family and keeps the 15px tick legible at 3:1 as a graphic.
const BOX_SIZE = 26;
const TICK_SIZE = 15;

/**
 * `CLAUDE.md` §21.3's standing disclaimer, in the two places §21.3 names:
 * once during onboarding, and in settings forever after.
 *
 * **The words are placeholder copy pending legal review** — see
 * `./copy.ts`, which carries that warning and the version identifier the
 * acknowledgment is recorded against.
 *
 * The acknowledged state is deliberately internal. It exists for the
 * length of one screen and has no other consumer, and holding it here is
 * what makes the invariant structural: there is no prop a caller can pass
 * to enable Continue, so no screen can accidentally offer a way past this
 * without the tick. The *record* of the acknowledgment is server-side and
 * is the caller's `onAcknowledge` to write (`me.medicalDisclaimer
 * .acknowledge`) — this component never persists anything.
 *
 * Names no colour of its own except the checkbox fill, which is §9's
 * primary gradient read from the active scheme, so both schemes are
 * correct by construction.
 */
export function MedicalDisclaimer(props: MedicalDisclaimerProps) {
  // `props` stays whole rather than destructured: the variant-specific
  // fields are only readable through the discriminant, and narrowing a
  // destructured `variant` does not narrow the siblings.
  const { density = 'client', testID } = props;
  const [acknowledged, setAcknowledged] = useState(false);
  const theme = useTheme();
  const themed = useThemedStyles();
  const bodySize = BODY_SIZE[density];

  return (
    <View testID={testID} style={styles.block}>
      <Card elevation="raised" density={density}>
        <Text size="eyebrow" tone="muted">
          {MEDICAL_DISCLAIMER_COPY.eyebrow}
        </Text>
        <Text size="h2" accessibilityRole="header" style={styles.title}>
          {MEDICAL_DISCLAIMER_COPY.title}
        </Text>
        <View style={styles.paragraphs}>
          {MEDICAL_DISCLAIMER_COPY.paragraphs.map((paragraph) => (
            <Text key={paragraph} size={bodySize}>
              {paragraph}
            </Text>
          ))}
        </View>
        {/* L3 tinted — `DESIGN.md` §2's only sanctioned way to say "this one
            is different" without colour-coding it. Never `urgent`: red is
            adherence and destructive actions, and this line is neither. */}
        <View style={styles.emergency}>
          <Card elevation="tinted" density={density}>
            <Text size="body" tone="warm">
              {MEDICAL_DISCLAIMER_COPY.emergency}
            </Text>
          </Card>
        </View>
      </Card>

      {props.variant === 'onboarding' ? (
        <>
          <Pressable
            onPress={() => setAcknowledged((previous) => !previous)}
            accessibilityRole="checkbox"
            accessibilityLabel={MEDICAL_DISCLAIMER_COPY.acknowledgeLabel}
            accessibilityState={{ checked: acknowledged }}
            pressScale={0.99}
            testID="medical-disclaimer-acknowledge"
            style={[
              styles.acknowledgeRow,
              themed.acknowledgeRow,
              acknowledged && themed.rowChecked,
            ]}
          >
            <View style={[styles.box, themed.box, acknowledged && themed.boxChecked]}>
              {acknowledged ? (
                <>
                  <LinearGradient
                    colors={[theme.colors.primary.from, theme.colors.primary.to]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                    style={StyleSheet.absoluteFill}
                  />
                  <Check size={TICK_SIZE} strokeWidth={3} color={theme.colors.fg.onBrand} />
                </>
              ) : null}
            </View>
            {/* Hidden from the reading order: the Pressable already carries
                this exact string as its label, and leaving the text visible
                to a screen reader reads it twice (`accessibility` §2). */}
            <View
              style={styles.acknowledgeLabel}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Text size="body">{MEDICAL_DISCLAIMER_COPY.acknowledgeLabel}</Text>
            </View>
          </Pressable>

          <Button
            variant="primary"
            density={density}
            fullWidth
            // The gate, at the only place it can be enforced. `Button`
            // blocks `onPress` while disabled, so an untouched checkbox
            // cannot fire `onAcknowledge` even if a caller passed one.
            disabled={!acknowledged}
            loading={props.submitting ?? false}
            onPress={props.onAcknowledge}
            accessibilityLabel={MEDICAL_DISCLAIMER_COPY.continueLabel}
            testID="medical-disclaimer-continue"
          >
            {MEDICAL_DISCLAIMER_COPY.continueLabel}
          </Button>
        </>
      ) : null}

      {props.variant === 'settings' && props.acknowledgedOn ? (
        <View style={[styles.recorded, themed.recorded]}>
          {/* A fact, not a judgement (`COPY.md` §CO1) — it states what was
              recorded and asks for nothing. */}
          <Text
            size="body-sm"
            tone="muted"
          >{`You acknowledged this on ${props.acknowledgedOn}.`}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing(16),
  },
  title: {
    marginTop: spacing(9),
  },
  paragraphs: {
    gap: spacing(13),
    marginTop: spacing(13),
  },
  emergency: {
    marginTop: spacing(14),
  },
  acknowledgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(13),
    // Min-height, never height: the label wraps to four lines at 200% text
    // and a fixed box would clip it (`accessibility` §3).
    minHeight: ACKNOWLEDGE_MIN_HEIGHT,
    paddingVertical: spacing(14),
    paddingHorizontal: spacing(14),
    borderRadius: radius.card,
    borderWidth: 1,
  },
  box: {
    width: BOX_SIZE,
    height: BOX_SIZE,
    borderRadius: spacing(8),
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  acknowledgeLabel: {
    flex: 1,
  },
  recorded: {
    paddingTop: spacing(16),
    borderTopWidth: 1,
  },
});

const useThemedStyles = createThemedStyles((theme) => ({
  // L1 inset — the recessed well `DESIGN.md` §2 gives a control, reached
  // through the scheme's own recipe rather than a colour named here.
  acknowledgeRow: {
    backgroundColor: theme.elevation.inset.backgroundColor,
    borderColor: theme.colors.border.strong,
  },
  rowChecked: {
    borderColor: theme.colors.brand.DEFAULT,
  },
  box: {
    backgroundColor: theme.control.surface,
    borderColor: theme.colors.border.strong,
  },
  boxChecked: {
    borderColor: theme.colors.brand.DEFAULT,
  },
  recorded: {
    borderTopColor: theme.colors.border.soft,
  },
}));
