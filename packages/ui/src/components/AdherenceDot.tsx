import { ADHERENCE_TOKEN, type AdherenceState } from '@coachos/utils';
import { StyleSheet, View } from 'react-native';

import { createThemedValue } from '../theme/createThemedStyles.ts';
import { radius, spacing, tapTarget } from '../theme/tokens.ts';

import { Pressable } from './Pressable.tsx';
import { Text } from './Text.tsx';

export type AdherenceDotSize = 'sm' | 'md';

/**
 * The words each state is announced and keyed with — `DESIGN.md` §8's own
 * names, which are also the four labels the coach prototype's roster key
 * renders verbatim. Exported so `AdherenceDotRow` builds its week summary
 * from the same strings rather than a second set.
 *
 * `not started` is deliberately not "no data yet" or "nothing logged":
 * §10.5 — absence of data is not failure, and the label must not read as
 * one.
 */
export const ADHERENCE_STATE_LABEL: Record<AdherenceState, string> = {
  'on-track': 'On plan',
  drifting: 'Drifting',
  'off-track': 'Off plan',
  'no-data': 'Not started',
};

type DotVisual = {
  /** The 1.5px ring. Always present, always the state's own hue. */
  ring: string;
  /** `undefined` renders a hollow ring — the §8 second channel, not a style choice. */
  fill: string | undefined;
  dashed: boolean;
  /** `0` renders no glow at all (`not started` has none in every prototype). */
  glowOpacity: number;
  glowRadius: number;
};

// §8's four states, as built in `DESIGN.dc.html` §05 and `CoachOS-Coach.dc.html`'s
// client rows. Every value here is copied from those two files, not derived:
// fill/ring/dash from the `dots` map, glow from the `box-shadow` beside it.
//
// Keyed by the TOKEN name from `packages/utils`, not by the state name, so
// the state -> token decision keeps living in `adherence.ts` (with the §8.2
// thresholds it belongs beside) and this file only decides what a token
// LOOKS like. Note the drift: `ADHERENCE_TOKEN`'s key names predate
// `DESIGN.md`'s rename of the states (on-track -> on plan, no-data -> not
// started). The names differ; the four states do not.
//
// The second, non-colour channel is the reason this is a record of four
// fields rather than four hexes. Desaturated, the ramp separates as:
// on-plan filled vs drifting hollow; drifting (L 0.334) vs off-plan
// (L 0.107) by lightness; off-plan vs not-started (L 0.101 — visually
// identical in greyscale) by dashed-vs-solid ring, and by NOTHING else.
// Dropping the dash makes a brand-new client indistinguishable from a
// failing one, which is the single failure §10.5 exists to prevent.
// Built once per scheme, never per render: this renders 210 times in a
// 30-row coach dashboard (`CLAUDE.md` §19).
const useVisuals = createThemedValue<Record<(typeof ADHERENCE_TOKEN)[AdherenceState], DotVisual>>(
  ({ colors }) => ({
    onTrack: {
      ring: colors.state.onPlan,
      fill: colors.state.onPlan,
      dashed: false,
      glowOpacity: 0.6,
      glowRadius: 10,
    },
    drifting: {
      ring: colors.state.drifting,
      fill: undefined,
      dashed: false,
      glowOpacity: 0.4,
      glowRadius: 8,
    },
    offTrack: {
      ring: colors.state.offPlan,
      fill: undefined,
      dashed: false,
      glowOpacity: 0.4,
      glowRadius: 8,
    },
    noData: {
      ring: colors.state.notStarted,
      fill: undefined,
      dashed: true,
      glowOpacity: 0,
      glowRadius: 0,
    },
  }),
);

// `CoachOS-Coach.dc.html`'s client row draws an 11px dot; `DESIGN.dc.html`
// §05's specimen draws 12px. Both at `border-radius:6px` with a `1.5px`
// border and `box-sizing:border-box`. There is no third size: a large
// adherence dot is a progress ring with a number in it, which is a
// different component.
export const ADHERENCE_DOT_DIAMETER: Record<AdherenceDotSize, number> = { sm: 11, md: 12 };
const BORDER_WIDTH = 1.5;
const LABEL_GAP = spacing(7);

export interface AdherenceDotProps {
  /**
   * A state NAME, never a score. A component that took a number would have
   * to compare it to something, and that comparison is already written down
   * once — `adherenceState()` in `packages/utils` (`CLAUDE.md` §8.2). No
   * threshold appears in this file, and none may.
   */
  state: AdherenceState;
  size?: AdherenceDotSize;
  /**
   * Renders the state's name beside the dot — the key form. §8 requires a
   * key wherever the state graphic appears more than eight times in one
   * view (a roster strip, a matrix), so this is a product requirement, not
   * a debug affordance.
   */
  label?: string;
  /**
   * For the one non-list case: a legend entry or a filter. Dots inside an
   * `AdherenceDotRow` are never individually tappable — seven 44px targets
   * do not fit on a 360dp row, so the ROW is the target instead.
   */
  onPress?: () => void;
  testID?: string;
}

/**
 * One adherence dot: `DESIGN.md` §8's warmth ramp plus its second,
 * non-colour channel. The palette has no green, so hue alone never carries
 * the state — filled, hollow, and dashed do half the work, and the ramp's
 * lightness ordering does the other half.
 *
 * **Do not "clean up" the fill and dash into four flat coloured dots.** They
 * look busier; without them the dashboard is unreadable for roughly one
 * coach in twelve, and nobody in that group will file a bug — they will just
 * find the product hard to use.
 *
 * Stateless, effect-free, and un-animated by design: this renders 210 times
 * in a 30-row coach dashboard (`CLAUDE.md` §19, >=55fps).
 *
 * **Accessibility:** announces the state in words when it stands alone.
 * Inside `AdherenceDotRow` the row hides its descendants and announces one
 * week summary instead, so a screen-reader user scrolling thirty clients
 * hears thirty sentences rather than four hundred and twenty dots.
 */
export function AdherenceDot({ state, size = 'md', label, onPress, testID }: AdherenceDotProps) {
  const visual = useVisuals()[ADHERENCE_TOKEN[state]];
  const diameter = ADHERENCE_DOT_DIAMETER[size];
  const stateLabel = ADHERENCE_STATE_LABEL[state];

  const dot = (
    <View
      style={[
        {
          width: diameter,
          height: diameter,
          borderRadius: radius.full,
          borderWidth: BORDER_WIDTH,
          borderColor: visual.ring,
          borderStyle: visual.dashed ? 'dashed' : 'solid',
          backgroundColor: visual.fill,
        },
        // The prototype's `0 0 10px rgba(...,.6)`. iOS only, deliberately:
        // Android's `elevation` draws an offset black drop shadow, which is
        // a different graphic, not a dimmer version of this one. The glow is
        // an accent — every state stays fully legible without it, which is
        // what makes leaving it off Android acceptable rather than a
        // platform fork of the design.
        visual.glowOpacity > 0
          ? {
              shadowColor: visual.ring,
              shadowOpacity: visual.glowOpacity,
              shadowRadius: visual.glowRadius,
              shadowOffset: { width: 0, height: 0 },
            }
          : null,
      ]}
    />
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        // The 44px floor (`DESIGN.md` §13) reached with symmetric `hitSlop`,
        // never by growing the dot — an 11px dot IS the design.
        hitSlop={Math.ceil((tapTarget.MIN - diameter) / 2)}
        accessibilityRole="button"
        accessibilityLabel={label ?? stateLabel}
        testID={testID}
        style={styles.row}
      >
        {dot}
        {label ? (
          <Text size="micro" tone="muted">
            {label}
          </Text>
        ) : null}
      </Pressable>
    );
  }

  return (
    <View accessible accessibilityLabel={label ?? stateLabel} testID={testID} style={styles.row}>
      {dot}
      {label ? (
        <Text size="micro" tone="muted">
          {label}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: LABEL_GAP,
  },
});
