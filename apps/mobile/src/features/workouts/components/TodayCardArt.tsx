import { createThemedValue, easing, useReducedMotion, withAlpha } from '@coachos/ui/theme';
import { useEffect } from 'react';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Ellipse, G, Line } from 'react-native-svg';

// The loaded barbell that bleeds off the hero's right edge, ported line for
// line from `CoachOS-Client.dc.html` L79–95 (`today-card/DESIGN-SPEC.md`
// §3.1). Three things the port drops, each on the spec's own instruction:
//
// - the prototype's infinite `bob`, because the card already carries one
//   infinite loop (the sheen) and this screen is opened several times a day;
// - the cursor/gyro parallax, which would need `expo-sensors` and therefore
//   a `CLAUDE.md` §3 entry;
// - every trace of it from the accessibility tree — it carries nothing the
//   chip, name and context line do not already say.
//
// It is absent entirely on the completed card (§3.3: a loaded bar after the
// session is over is a mixed message) and on the rest-day one (§6).

const WIDTH = 210;
const HEIGHT = 160;

/** §3.1's `riseplate` — 620ms, `easing.rise`, after a 180ms beat. */
const RISE_DURATION_MS = 620;
const RISE_DELAY_MS = 180;

const RISE_EASING = Easing.bezier(easing.rise[0], easing.rise[1], easing.rise[2], easing.rise[3]);

export function TodayCardArt() {
  const palette = useArtPalette();
  const reducedMotion = useReducedMotion();
  const rise = useSharedValue(reducedMotion ? 1 : 0);

  useEffect(() => {
    if (reducedMotion) {
      // Not a removal — the plate still arrives, it just arrives in place
      // (`accessibility` §6).
      rise.value = 1;
      return;
    }
    rise.value = withDelay(
      RISE_DELAY_MS,
      withTiming(1, { duration: RISE_DURATION_MS, easing: RISE_EASING }),
    );
    // `rise` is a Reanimated shared value: stable identity, not a reactive dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  const plateStyle = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [{ translateY: 12 * (1 - rise.value) }, { scale: 0.95 + 0.05 * rise.value }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          position: 'absolute',
          right: -8,
          top: -6,
          width: WIDTH,
          height: HEIGHT,
        },
        plateStyle,
      ]}
    >
      <Svg viewBox="0 0 220 170" width={WIDTH} height={HEIGHT}>
        {/* The isometric ground lines. Static: they are the floor, and a
            floor that animates reads as an earthquake. */}
        <G stroke={palette.ground} strokeWidth={1} fill="none">
          <Line x1={18} y1={128} x2={118} y2={158} />
          <Line x1={66} y1={114} x2={166} y2={144} />
          <Line x1={114} y1={100} x2={214} y2={130} />
          <Line x1={18} y1={128} x2={114} y2={100} />
          <Line x1={66} y1={142} x2={162} y2={114} />
        </G>
        <G>
          <Line
            x1={46}
            y1={96}
            x2={176}
            y2={60}
            stroke={palette.bar}
            strokeWidth={3}
            strokeLinecap="round"
          />
          <Ellipse
            cx={60}
            cy={92}
            rx={8}
            ry={20}
            transform="rotate(-16 60 92)"
            fill={palette.plateOuter}
            stroke={palette.bar}
            strokeWidth={1.6}
          />
          <Ellipse
            cx={74}
            cy={88}
            rx={11}
            ry={27}
            transform="rotate(-16 74 88)"
            fill={palette.plateInner}
            stroke={palette.bar}
            strokeWidth={1.6}
          />
          <Ellipse
            cx={150}
            cy={67}
            rx={11}
            ry={27}
            transform="rotate(-16 150 67)"
            fill={palette.plateInner}
            stroke={palette.bar}
            strokeWidth={1.6}
          />
          <Ellipse
            cx={164}
            cy={63}
            rx={8}
            ry={20}
            transform="rotate(-16 164 63)"
            fill={palette.plateOuter}
            stroke={palette.bar}
            strokeWidth={1.6}
          />
          <Ellipse
            cx={71}
            cy={88}
            rx={4}
            ry={10}
            transform="rotate(-16 71 88)"
            fill="none"
            stroke={palette.collar}
            strokeWidth={1}
          />
          <Ellipse
            cx={147}
            cy={67}
            rx={4}
            ry={10}
            transform="rotate(-16 147 67)"
            fill="none"
            stroke={palette.collar}
            strokeWidth={1}
          />
        </G>
      </Svg>
    </Animated.View>
  );
}

// SVG fills and strokes are the case `useTheme()` exists for — there is no
// `className` equivalent. Composed from the scheme rather than the
// prototype's hexes so a white-label brand carries through, and so the art
// is not a second place the palette lives.
//
// The two plate fills are the prototype's `#2A3550`/`#313D57`, which sit
// between `bg.raised` and `bg.raised-end`; the scheme's own two raised
// stops are used instead, in the same order (outer darker, inner lighter).
const useArtPalette = createThemedValue(({ colors }) => ({
  ground: withAlpha(colors.brand.DEFAULT, '0.2'),
  bar: colors.brand.DEFAULT,
  plateOuter: colors.bg['raised-end'],
  plateInner: colors.bg.raised,
  collar: withAlpha(colors.fg.glass, '0.5'),
}));
