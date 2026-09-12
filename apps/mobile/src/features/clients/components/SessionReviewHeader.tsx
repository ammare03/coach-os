import { GlassSurface, Pressable, Skeleton, Text } from '@coachos/ui';
import {
  createThemedStyles,
  createThemedValue,
  duration as durationTokens,
  easing,
  radius,
  spacing,
  useReducedMotion,
  withAlpha,
} from '@coachos/ui/theme';
import { Check, X } from 'lucide-react-native';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

// `session-review/01` — THE navbar on this route.
//
// `(coach)/_layout.tsx` registers `session/[id]` as `fullScreenModal` with
// `gestureEnabled: false`, under a group-wide `headerShown: false`. So
// there is no dock, no router header, and **no edge swipe** — the screen
// draws its own chrome and its one exit, and this is it.
//
// Geometry is `LoggerHeader`'s, deliberately: the two are the same bar on
// the two halves of one workout, and a coach who has seen the client app
// should not meet a second dialect of it. `flex: none`, so it never
// collapses, shrinks, fades or parallaxes (`DESIGN.md` §5); the body below
// is clipped at its lower edge rather than passing behind the blur, which
// is why the glass only ever has §3's ambient layer behind it.
//
// Glass appears exactly ONCE on this screen and it is here. The Close pill
// inside it is a plain translucent fill, not a second `GlassSurface` —
// `DESIGN.md` §4's "never nest glass inside glass".

export const SESSION_REVIEW_COPY = {
  /**
   * **`Close`, not `Back`.** A full-screen modal dismisses; it does not pop
   * a stack. A left chevron would promise a pop that is not happening, and
   * with `gestureEnabled: false` there is no second way out to fall back
   * on — so the control carries the whole affordance and takes a WORD as
   * well as a glyph (`DESIGN.md` §13, "an icon never travels alone in
   * navigation").
   */
  close: 'Close',
  closeSpoken: 'Close this session',
  /**
   * **Reviewed is a STATE, never a control**, so there is no "Mark
   * reviewed" anywhere in this feature and there must not be one: opening
   * the session IS the review (§8.2), and `session.review` writes
   * `reviewed_at` as a side effect of the read. A button that turns into a
   * label after you press it would teach a coach the state was theirs to
   * choose.
   */
  reviewed: 'Reviewed',
} as const;

/** §9's screen-header geometry: the prototype's own bar draws at 22, which is `radius.section`. */
const BAR_RADIUS = radius.section;
/**
 * `ui-conventions` §5's floor, not `tapTarget.MIN`'s 44 — the same number,
 * for the same reason, as `LoggerHeader`'s exit. This is the ONLY way out
 * of a focus mode, so it takes the larger of the two general floors.
 */
const EXIT_MIN_HEIGHT = 48;
const EXIT_ICON_SIZE = 15;
const CHECK_ICON_SIZE = 14;
/**
 * The reviewed slot's reserved width. Held whether or not the state has
 * arrived, so the words in the middle do not shift sideways when it lands.
 */
const REVIEWED_MIN_WIDTH = 58;
const TITLE_SKELETON_WIDTH = 104;
const TITLE_SKELETON_HEIGHT = 15;
const SUBLINE_SKELETON_WIDTH = 136;
const SUBLINE_SKELETON_HEIGHT = 11;

export interface SessionReviewHeaderProps {
  /** `null` holds a skeleton: a title that arrives and then changes is worse than one that arrives once. */
  title: string | null;
  /** `Priya Sharma · logged Tue 9 Sep`, or `null` while nothing is known. */
  subtitle: string | null;
  /**
   * True once the read has landed — which is also the moment the server
   * wrote `reviewed_at`. False reserves the slot and renders it invisible
   * rather than empty: it is not known yet, not absent.
   */
  isReviewed: boolean;
  /** The one exit. Never depends on the read — it works in every state, including both failures. */
  onClose: () => void;
}

export function SessionReviewHeader({
  title,
  subtitle,
  isReviewed,
  onClose,
}: SessionReviewHeaderProps) {
  const themed = useThemedStyles();
  const ink = useHeaderInk();

  return (
    <GlassSurface tier="tier2" style={[styles.bar, { borderRadius: BAR_RADIUS }]}>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={SESSION_REVIEW_COPY.closeSpoken}
        style={[styles.exit, themed.exit]}
        testID="session-review-close"
      >
        <X size={EXIT_ICON_SIZE} color={ink.glass} strokeWidth={2.4} />
        <Text size="label" tone="glass">
          {SESSION_REVIEW_COPY.close}
        </Text>
      </Pressable>

      <View style={styles.words}>
        {title === null ? (
          <Skeleton
            width={TITLE_SKELETON_WIDTH}
            height={TITLE_SKELETON_HEIGHT}
            radius="chip"
            accessibilityLabel="Loading this session"
          />
        ) : (
          // No `numberOfLines`: at 200% text a long day name wraps and the
          // bar grows with it rather than clipping (`accessibility` §3).
          <Text size="label" tone="glass" accessibilityRole="header" style={styles.centred}>
            {title}
          </Text>
        )}

        {subtitle === null ? (
          title === null ? (
            <Skeleton
              width={SUBLINE_SKELETON_WIDTH}
              height={SUBLINE_SKELETON_HEIGHT}
              radius="chip"
              style={styles.subLine}
            />
          ) : null
        ) : (
          <Text
            size="micro"
            tone="warm-muted"
            style={[styles.centred, styles.subLine, styles.tabular]}
          >
            {subtitle}
          </Text>
        )}
      </View>

      <ReviewedState isReviewed={isReviewed} />
    </GlassSurface>
  );
}

/**
 * It arrives; it is not pressed.
 *
 * Opacity only, over `duration.state`, with **no movement** — `DESIGN.md`
 * §5 forbids motion on a value someone is reading, and this is one. The
 * box is present and reserved in both states, so nothing in the bar shifts
 * when it settles.
 *
 * Hidden from the reading order while pending: an unreviewed session has
 * not been reviewed, and announcing the word before it is true would be the
 * one thing this state must never do.
 */
function ReviewedState({ isReviewed }: { isReviewed: boolean }) {
  const ink = useHeaderInk();
  const reducedMotion = useReducedMotion();
  const settled = useSharedValue(isReviewed ? 1 : 0);

  useEffect(() => {
    settled.value = withTiming(isReviewed ? 1 : 0, {
      duration: reducedMotion ? 0 : durationTokens.state,
      easing: OUT,
    });
  }, [isReviewed, reducedMotion, settled]);

  const style = useAnimatedStyle(() => ({ opacity: settled.value }));

  return (
    <Animated.View
      style={[styles.reviewed, style]}
      accessibilityElementsHidden={!isReviewed}
      importantForAccessibility={isReviewed ? 'auto' : 'no-hide-descendants'}
      testID="session-review-reviewed"
    >
      {/* A glyph AND the word: "Reviewed" is the second, non-colour channel
          (`accessibility` §4), and it is the one a screen reader hears. */}
      <Check size={CHECK_ICON_SIZE} color={ink.check} strokeWidth={2.4} />
      <Text size="micro" tone="warm-muted" style={styles.centred}>
        {SESSION_REVIEW_COPY.reviewed}
      </Text>
    </Animated.View>
  );
}

const OUT = Easing.bezier(easing.out[0], easing.out[1], easing.out[2], easing.out[3]);

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(10),
    // The prototype's own inset from the device edge, and its padding.
    marginHorizontal: spacing(14),
    marginBottom: spacing(10),
    paddingVertical: spacing(8),
    paddingLeft: spacing(8),
    paddingRight: spacing(10),
  },
  exit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(7),
    // `minHeight`, never `height` — the floor is a floor, and at 200% text
    // the label needs the room to push past it (`accessibility` §3).
    minHeight: EXIT_MIN_HEIGHT,
    paddingHorizontal: spacing(14),
    borderRadius: EXIT_MIN_HEIGHT / 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  words: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  centred: {
    textAlign: 'center',
  },
  subLine: {
    marginTop: spacing(3),
  },
  tabular: {
    fontVariant: ['tabular-nums'],
  },
  reviewed: {
    minWidth: REVIEWED_MIN_WIDTH,
    alignItems: 'center',
    gap: spacing(3),
    paddingRight: spacing(4),
  },
});

const useThemedStyles = createThemedStyles(({ colors }) => ({
  exit: {
    backgroundColor: withAlpha(colors.bg.inset, '0.45'),
    borderColor: withAlpha(colors.fg.glass, '0.14'),
  },
}));

/**
 * The check walks `DESIGN.md` §1.1's warm ramp down under light, exactly as
 * the record mark does one file over — `brand` is scheme-invariant and
 * `#FFA586` does not carry on a white glass. Screen-local, not a token
 * change (UNFORGET A11).
 */
const useHeaderInk = createThemedValue(({ scheme, colors }) => ({
  glass: colors.fg.glass,
  check: scheme === 'light' ? colors.brand.deep : colors.brand.DEFAULT,
}));
