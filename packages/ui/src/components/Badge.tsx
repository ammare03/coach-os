import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { colors, control, radius, type TextSize } from '../theme/tokens.ts';

import { Metric } from './Metric.tsx';

export type BadgeTone = 'neutral' | 'brand';
export type BadgeSize = 'sm' | 'md';

interface BadgeBase {
  tone?: BadgeTone;
  size?: BadgeSize;
  testID?: string;
}

// `count` and `label` are mutually exclusive by construction — a
// discriminated union of shapes, not two independent optionals
// (`code-conventions` §3) — so a call site literally cannot pass both and
// leave the render branch to guess which one wins. Neither present renders
// a bare dot.
export type BadgeProps =
  | (BadgeBase & { count: number; label?: undefined })
  | (BadgeBase & { label: string; count?: undefined })
  | (BadgeBase & { count?: undefined; label?: undefined });

// DESIGN.md §8 reserves the palette's red/maroon (`urgent`) for adherence
// state — missed, overdue, destructive — and nothing else. A badge is the
// single most likely place someone reaches for red "because it's a
// notification": a red unread count sitting beside a coach's warmth-ramp
// adherence dot destroys the colour scan the whole product depends on.
// There is deliberately no `urgent`/`danger` tone here. This WILL be
// requested again in P15's notification work — the answer stays `brand` +
// position (a badge already reads as "notification" from where it sits on
// a tab icon or list row), not a colour exception.
//
// DESIGN.md's palette (§1.1) also has no separate `accent`/`realtime` hue
// any more (the six source swatches are base/raised/raised-end/border/
// brand/urgent) — `brand` already carries "new"/"live" emphasis, so the
// earlier task doc's third `accent` tone is dropped rather than mapped to
// a colour that no longer exists in `tokens.ts`.
const NEUTRAL_BACKGROUND = control.surface;
// DESIGN.md §9's dock badge border — `bg.DEFAULT` at 60%, the same ring an
// avatar's presence dot wears, so both come from one token.
const BRAND_BORDER = control.ring;

const DIAMETER: Record<BadgeSize, number> = { sm: 17, md: 20 };
const METRIC_SIZE: Record<BadgeSize, TextSize> = { sm: 'micro', md: 'caption' };
const BORDER_WIDTH = 1.5;

function formatCount(count: number): string {
  const safe = Math.max(0, Math.trunc(count));
  return safe > 99 ? '99+' : String(safe);
}

/**
 * A count, a short status label, or (given neither) a bare "new" dot —
 * never interactive, never focusable on its own (`ui-primitives-core/05`).
 * Counts render through `Metric` (tabular numerals), capped at `99+` so a
 * count ticking from 9 to 10 never widens the row it sits in.
 *
 * **Accessibility contract:** always hidden from the screen reader
 * (`accessibilityElementsHidden` / `importantForAccessibility="no"`) — a
 * standalone focusable "3" tells a screen-reader user nothing on its own.
 * The CONSUMER folds the count into its own label, e.g.
 * `accessibilityLabel="Messages, 3 unread"` on the row/icon this badge
 * decorates, never here.
 */
export function Badge({ count, label, tone = 'neutral', size = 'sm', testID }: BadgeProps) {
  const diameter = DIAMETER[size];
  const content = count !== undefined ? formatCount(count) : label;
  const isDot = content === undefined;
  const isBrand = tone === 'brand';

  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        styles.base,
        {
          minWidth: diameter,
          height: diameter,
          borderRadius: radius.full,
          borderWidth: BORDER_WIDTH,
          borderColor: isBrand ? BRAND_BORDER : colors.border.strong,
          backgroundColor: isBrand ? undefined : NEUTRAL_BACKGROUND,
          paddingHorizontal: isDot ? 0 : Math.round(diameter * 0.22),
        },
      ]}
    >
      {isBrand ? (
        <LinearGradient
          colors={[colors.brand.DEFAULT, colors.brand.mid]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {!isDot ? (
        // `default` is the closest tone `Metric` currently offers to the
        // dark ink DESIGN.md §1.1's "primary fill inverts" rule calls for
        // against this bright gradient (the same rule `primary.from/to`
        // follows). `Metric` has no `onBrand` tone (unlike `Text`, which
        // does) — flagged as a follow-up for `Metric.tsx`, out of this
        // component's scope; on `neutral`'s dark translucent fill `default`
        // already has full contrast.
        <Metric value={content} size={METRIC_SIZE[size]} tone="default" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
