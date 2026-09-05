// `expo-glass-effect` and `expo-blur` are imported in this ONE file in the
// whole repo (`ui-primitives-core/07`'s acceptance criteria) — no screen,
// and no other primitive, imports either directly. `ui-conventions` §5
// makes the same rule for consumers: ask for a `<GlassSurface>`, never a
// platform check.
import { BlurView } from 'expo-blur';
import { GlassContainer, GlassView } from 'expo-glass-effect';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { schemes } from '../theme/schemes.ts';
import { colors, type GlassTier } from '../theme/tokens.ts';
import { useTheme } from '../theme/useTheme.ts';

import { useGlassAvailable } from './useGlassAvailable.ts';

export type { GlassTier };

// DESIGN.md §8's four adherence hues plus `urgent` — rejected outright as
// a `tint`, not merely discouraged. A status colour bleeding into
// navigation chrome is exactly the "colour means something" bug §8 exists
// to prevent, so a coach's own scan of the app stays trustworthy.
// `as const`, not `readonly string[]` — widening this to `string[]` would
// also widen `AdherenceHex` below to plain `string`, which silently turns
// `GlassTint<T>` into `never` for every input (the exact bug the type
// guard exists to prevent).
const ADHERENCE_HUES = [
  colors.state.onPlan,
  colors.state.drifting,
  colors.state.offPlan,
  colors.state.notStarted,
  colors.urgent,
] as const;

// A plain `Set<string>` for the runtime `.includes`-style check — kept
// separate from `ADHERENCE_HUES` so the literal tuple above stays literal
// for `AdherenceHex` while this stays comparable against an arbitrary
// runtime string (a coach's white-label hex).
// Both schemes' hues, not just dark's: the rule is "a status colour never
// tints chrome", and a light-scheme `state.onPlan` is as much a status
// colour as a dark one. The tuple above stays dark-only because its job is
// the TYPE-level rejection, which needs literals.
const ADHERENCE_HUE_SET: ReadonlySet<string> = new Set<string>([
  ...ADHERENCE_HUES,
  ...Object.values(schemes.light.state),
  schemes.light.urgent,
]);

type AdherenceHex = (typeof ADHERENCE_HUES)[number];

/**
 * Rejects the literal adherence hues at the TYPE level (assigning
 * `colors.urgent` or one of `colors.state.*` directly as `tint` fails to
 * compile) — a computed hex, e.g. a coach's white-label colour resolved at
 * runtime, still passes the type and is caught by the runtime guard below
 * (`ui-primitives-core/07` approach §4).
 */
export type GlassTint<T extends string = string> = T extends AdherenceHex ? never : T;

export interface GlassSurfaceProps<T extends string = string> {
  /** The tier vocabulary from `tokens.ts` (`tier1` dock/action bar, `tier2` hero/sheet/header, `tier3` chip/avatar/icon button) — never the raw platform `'regular' | 'clear'` enum. */
  tier: GlassTier;
  /** A white-label brand tint, clamped to a low opacity for contrast. Never an adherence colour — see `GlassTint`. */
  tint?: GlassTint<T>;
  interactive?: boolean;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

// `tier` -> the platform's own two-value style vocabulary. `tier1` (dock,
// action bar, tool palette) is the tier whose primary named consumer is
// the video annotator's toolbar (`ui-primitives-core/07`'s blocks list) —
// chrome over rich imagery, which is exactly `clear`'s use case (DESIGN.md
// §12.1's old "clear for chrome over video or imagery"). `tier2`/`tier3`
// sit over ordinary UI and take `regular`. DESIGN.md does not spell this
// mapping out per tier; it is a judgement call, flagged here for review if
// a `tier1` consumer turns out not to be over media.
const GLASS_EFFECT_STYLE: Record<GlassTier, 'regular' | 'clear'> = {
  tier1: 'clear',
  tier2: 'regular',
  tier3: 'regular',
};

// The prototype's CSS `blur()` values (34/30/18px, the `glass.tierN.blur`
// tokens) don't map 1:1 to `expo-blur`'s 1-100 `intensity` scale — this
// derives a proportional intensity from each tier's own blur token rather
// than inventing three new unrelated numbers. Blur is scheme-invariant;
// only the gradient over it changes.
const MAX_INTENSITY = 90;

function blurIntensityFor(blurPx: number, maxBlurPx: number): number {
  return Math.round((blurPx / maxBlurPx) * MAX_INTENSITY);
}

function isAdherenceHue(value: string): boolean {
  return ADHERENCE_HUE_SET.has(value);
}

// DS§12's "low opacity only" for a white-label tint riding on top of the
// tier's own gradient.
const TINT_ALPHA = 0.14;

// Every corner-radius key React Native's `ViewStyle` defines. The clip layer
// below has to reproduce whatever the caller set on the surface, or a
// rounded dock renders a square gradient inside it.
const RADIUS_KEYS = [
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'borderTopStartRadius',
  'borderTopEndRadius',
  'borderBottomStartRadius',
  'borderBottomEndRadius',
  'borderStartStartRadius',
  'borderStartEndRadius',
  'borderEndStartRadius',
  'borderEndEndRadius',
] as const satisfies readonly (keyof ViewStyle)[];

/**
 * The caller's corner radii, and nothing else, lifted out of `style` so the
 * clip layer can wear the same shape the surface does. Only the radii —
 * everything else in `style` (position, size, padding, margin) stays on the
 * surface itself, where every existing consumer already depends on it
 * landing.
 */
function clipRadius(style: StyleProp<ViewStyle>): ViewStyle {
  const flat: ViewStyle | undefined = StyleSheet.flatten(style);
  const picked: ViewStyle = {};
  for (const key of RADIUS_KEYS) {
    const value = flat?.[key];
    if (value !== undefined) Object.assign(picked, { [key]: value });
  }
  return picked;
}

function tintOverlayColor(tint: string): string {
  const match = /^#([0-9a-fA-F]{6})$/.exec(tint);
  const digits = match?.[1];
  if (!digits) return tint;
  const int = Number.parseInt(digits, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${TINT_ALPHA})`;
}

/**
 * The Liquid Glass primitive — one place that resolves which of three
 * things a "glass surface" actually renders, so no screen has to carry its
 * own platform check (`ui-primitives-core/07`'s "Why this exists"):
 *
 * 1. iOS 26+, transparency allowed -> real Liquid Glass (`<GlassView>`).
 * 2. Anything else, transparency allowed -> `<BlurView>` + the tier's warm
 *    gradient overlay (RN has no `saturate()`; the gradient's own warmth
 *    is the compensation DESIGN.md §12 asks for) + the inset-edge hairlines.
 * 3. Reduce Transparency OR Increase Contrast on -> the OPAQUE `elevation`
 *    fallback. No blur, no translucency, fully opaque, regardless of
 *    platform — this is not a lighter blur, it is a different material.
 *
 * **The two inset edges are the whole trick** (DESIGN.md §4/§12): RN has
 * no inset `box-shadow`, so both the blur and native paths fake it with
 * absolutely-positioned 1px hairlines — a bright one at the top, a dark
 * one at the bottom. Skipping them collapses the effect.
 *
 * **The outer drop belongs here too, on all three paths.** §4 gives tier 1
 * and tier 2 "a long soft drop" and gives tier 3 none; §9's Dock row spells
 * tier 1's out as `0 18px 40px -14px rgba(0,0,0,.8)`. It cannot ride on the
 * same view that clips the decoration: `overflow: 'hidden'` is
 * `clipsToBounds` on iOS and suppresses the view's own shadow. So the clip
 * boundary moved INWARD — it is now an absolutely-filled layer holding the
 * blur, the gradient, the border and the hairlines — and the surface view
 * itself, which still receives the caller's `style` untouched, carries the
 * shadow. A wrapper on the OUTSIDE would have had to swallow `style` to
 * position itself, and `style` carries padding (the auth nav bar's status
 * inset) and absolute insets (both docks) that have to keep applying to the
 * surface. One consequence, and it is deliberate: `children` are no longer
 * clipped to the surface's corners, only the material is.
 *
 * **Never nest a `<GlassSurface>` inside another one, and never place one
 * over a chart** (DESIGN.md §4/§9) — the primitive does not and cannot
 * enforce either; both are review-checklist rules (`ui-conventions` §5).
 * **Never animate this surface's geometry per frame** — it may move on a
 * screen transition, never track a scroll offset or a gesture
 * (`frontend-performance` skill §6.1).
 */
export function GlassSurface<T extends string = string>({
  tier,
  tint,
  interactive = false,
  children,
  style,
  testID,
}: GlassSurfaceProps<T>) {
  const { canUseGlass, transparencyAllowed } = useGlassAvailable();
  const { glass } = useTheme();

  if (tint && isAdherenceHue(tint)) {
    throw new Error(
      'GlassSurface: `tint` may not be an adherence colour (DESIGN.md §8) — a status hue must never tint navigation chrome.',
    );
  }

  if (canUseGlass) {
    return (
      // `exactOptionalPropertyTypes` forbids passing `tintColor={undefined}`/
      // `testID={undefined}` explicitly against `expo-glass-effect`'s own
      // (non-`undefined`-inclusive) optional types, so both are spread in
      // conditionally rather than always assigned.
      <GlassView
        glassEffectStyle={GLASS_EFFECT_STYLE[tier]}
        isInteractive={interactive}
        // The tier's own drop, first so a caller's `style` can still
        // override it. `undefined` on tier 3, which §4 gives no outer
        // shadow — an absent shadow, never a zeroed one.
        style={[glass[tier].shadow, style]}
        {...(tint ? { tintColor: tintOverlayColor(tint) } : {})}
        {...(testID ? { testID } : {})}
      >
        {children}
      </GlassView>
    );
  }

  if (!transparencyAllowed) {
    return (
      <OpaqueFallback tier={tier} style={style} testID={testID}>
        {children}
      </OpaqueFallback>
    );
  }

  return (
    <BlurFallback tier={tier} tint={tint} style={style} testID={testID}>
      {children}
    </BlurFallback>
  );
}

/**
 * Reduce Transparency / Increase Contrast (either one, any platform) —
 * `elevation.raised` (L2), never a lighter blur (DESIGN-SYSTEM.md DS§10
 * rejects an emulated "half-glass" compromise outright: it costs GPU on
 * the device that can least afford it and satisfies neither the visual
 * spec nor the accessibility need).
 */
function OpaqueFallback({
  tier,
  style,
  testID,
  children,
}: {
  tier: GlassTier;
  style?: StyleProp<ViewStyle>;
  // `| undefined` (not just `?`) so `GlassSurface` can forward its own
  // possibly-`undefined` `testID` straight through under
  // `exactOptionalPropertyTypes` — this is an internal helper, not a
  // library type, so this is the one lever available to fix at the source
  // rather than a call-site conditional spread.
  testID?: string | undefined;
  children?: ReactNode;
}) {
  const { elevation, glass } = useTheme();
  const recipe = elevation.raised;
  // The drop follows the MATERIAL, not the tier: this path renders L2, so
  // it takes L2's own `0 10px 24px -14px` (DESIGN.md §2) rather than §4's
  // longer glass drop, which is calibrated for a translucent surface.
  // Whether the surface floats at all is still the TIER's decision — §4
  // gives tier 3 no outer shadow, and a chip must not grow one just because
  // Reduce Transparency is on.
  const shadow = glass[tier].shadow ? recipe.shadow : undefined;
  return (
    <View testID={testID} style={[shadow, style]}>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip, clipRadius(style)]}>
        <LinearGradient
          colors={recipe.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            { borderWidth: recipe.borderWidth, borderColor: recipe.borderColor },
          ]}
        />
        <View style={[styles.hairlineTop, { backgroundColor: recipe.highlight }]} />
      </View>
      {children}
    </View>
  );
}

/** Android, or iOS below 26, with transparency allowed. */
function BlurFallback({
  tier,
  tint,
  style,
  testID,
  children,
}: {
  tier: GlassTier;
  tint?: string | undefined;
  style?: StyleProp<ViewStyle>;
  testID?: string | undefined;
  children?: ReactNode;
}) {
  const { glass, scheme } = useTheme();
  const tierTokens = glass[tier];
  return (
    // §4's long soft drop, on the surface itself — the clip layer below is
    // what wears `overflow: 'hidden'`, so nothing suppresses it.
    <View testID={testID} style={[tierTokens.shadow, style]}>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip, clipRadius(style)]}>
        <BlurView
          // The blur samples what is BEHIND the surface, so it follows the
          // canvas, not the tier — a dark blur over a light canvas is a smear.
          tint={scheme === 'light' ? 'light' : 'dark'}
          intensity={blurIntensityFor(tierTokens.blur, glass.tier1.blur)}
          blurMethod="dimezisBlurViewSdk31Plus"
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={tierTokens.gradient}
          locations={tierTokens.locations}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.4, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {tint ? (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: tintOverlayColor(tint) }]} />
        ) : null}
        <View
          style={[StyleSheet.absoluteFill, { borderWidth: 1, borderColor: tierTokens.borderColor }]}
        />
        <View style={[styles.hairlineTop, { backgroundColor: tierTokens.highlight }]} />
        {tierTokens.lowlight ? (
          <View style={[styles.hairlineBottom, { backgroundColor: tierTokens.lowlight }]} />
        ) : null}
      </View>
      {children}
    </View>
  );
}

export interface GlassSurfaceGroupProps {
  /** Distance at which adjacent glass elements start merging, passed straight to the native `GlassContainer`. */
  spacing?: number;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Merges two or more sibling `<GlassSurface>`s into one material on the
 * glass path — two independent glass views side by side are both more
 * expensive and visually wrong, since they will not blend at their shared
 * edge (`ui-primitives-core/07` approach §5). Inert (a plain container) on
 * both fallback paths: each child already renders its own opaque/blur
 * fallback independently, so there is nothing to merge.
 */
export function GlassSurfaceGroup({ spacing, children, style }: GlassSurfaceGroupProps) {
  const { canUseGlass } = useGlassAvailable();

  if (canUseGlass) {
    return (
      // Same `exactOptionalPropertyTypes` constraint as `GlassView` above —
      // `spacing` is only spread in when actually provided.
      <GlassContainer style={style} {...(spacing !== undefined ? { spacing } : {})}>
        {children}
      </GlassContainer>
    );
  }

  return <View style={style}>{children}</View>;
}

const styles = StyleSheet.create({
  // The clipping boundary, moved off the surface view so the surface can
  // carry its own outer drop — `overflow: 'hidden'` is `clipsToBounds` on
  // iOS and suppresses a view's shadow. `pointerEvents="none"` at the call
  // site: this layer covers the whole surface and must never intercept a
  // touch meant for what the caller put inside it.
  clip: {
    overflow: 'hidden',
  },
  hairlineTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
  },
  hairlineBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
  },
});
