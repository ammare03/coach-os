import { StyleSheet, View } from 'react-native';

import { colors, density as densityTokens, spacing, type Density } from '../theme/tokens.ts';

import { Card } from './Card.tsx';
import { SkeletonCircle } from './SkeletonCircle.tsx';
import { SkeletonText } from './SkeletonText.tsx';

/**
 * Three rough content shapes, not thirty. A route asks for the one its
 * content resembles; anything more specific is hand-assembled from
 * `Skeleton` at the call site, which is where the real layout is known.
 */
export type LoadingShape = 'list' | 'detail' | 'card';

export interface LoadingStateProps {
  shape?: LoadingShape;
  /** `list` only — the other two shapes ignore it. */
  rows?: number;
  /**
   * Not optional, by design. A screen made of skeletons is silent to a
   * screen reader unless something says the region is loading
   * (`accessibility` §2), and this component IS the region — so the label
   * is required here even though it is optional on `Skeleton`, and it goes
   * to exactly one shape inside so the whole block reads as one busy item.
   * Name what is loading: "Loading clients", not "Loading".
   */
  accessibilityLabel: string;
  density?: Density;
  testID?: string | undefined;
}

// `DESIGN.md` §9's list row: 36px avatar, 11–12px gap, a 1px `border.soft`
// rule underneath. The row's own height is `density[d].row` (66/56), which
// is §9's 50–66px band expressed as the density pair.
const ROW_AVATAR = 36;

/**
 * `DESIGN.md` §9's stat tile — eyebrow, value, sub — as an L2 card whose
 * chrome is real and whose contents are not yet. Shared by the `card` and
 * `detail` shapes so the two cannot drift.
 */
function CardBlock({
  density,
  accessibilityLabel,
}: {
  density: Density;
  accessibilityLabel?: string | undefined;
}) {
  return (
    <Card elevation="raised" density={density}>
      <View style={styles.cardLines}>
        <SkeletonText size="eyebrow" lastLineWidth="34%" accessibilityLabel={accessibilityLabel} />
        <SkeletonText size="stat" lastLineWidth="58%" />
        <SkeletonText size="body-sm" lastLineWidth="46%" />
      </View>
    </Card>
  );
}

/**
 * The first-load state for a region that is fetching. `DESIGN.md` §5
 * forbids "spinners where a skeleton belongs" and `UI-UX.md` §UX4.2 asks
 * for "a skeleton matching the real layout — same heights, same rhythm",
 * so this composes `Skeleton` shapes and contains no spinner at any shape.
 *
 * It adds **no padding of its own** — unlike `EmptyState`, which is a
 * designed block with 52/20 around it, a loading state stands in for
 * content that already sits inside the screen's gutter. Padding here would
 * shift the layout at the exact moment the data lands, which is the one
 * thing a skeleton exists to prevent (`UI-UX.md` §UX5.1).
 *
 * Cached data renders instead of this (§UX4.2) — a tab switch after first
 * load never shows a skeleton, let alone a spinner.
 */
export function LoadingState({
  shape = 'list',
  rows = 5,
  accessibilityLabel,
  density: densityProp = 'client',
  testID,
}: LoadingStateProps) {
  const densityValues = densityTokens[densityProp];

  if (shape === 'card') {
    return (
      <View testID={testID}>
        <CardBlock density={densityProp} accessibilityLabel={accessibilityLabel} />
      </View>
    );
  }

  if (shape === 'detail') {
    return (
      <View testID={testID} style={{ gap: densityValues.sectionGap }}>
        <View style={styles.titleBlock}>
          <SkeletonText
            size="eyebrow"
            lastLineWidth="26%"
            accessibilityLabel={accessibilityLabel}
          />
          <SkeletonText size="h1" lastLineWidth="72%" />
        </View>
        <SkeletonText size="body" lines={3} lastLineWidth="54%" />
        <CardBlock density={densityProp} />
      </View>
    );
  }

  const count = Math.max(1, rows);

  return (
    <View testID={testID}>
      {Array.from({ length: count }, (_, index) => (
        // An index key is correct here and only here: a placeholder list has
        // no identity and never reorders (`UI-UX.md` §UX6.3 rule 13).
        <View
          key={index}
          style={[
            styles.row,
            // Min-height, never height: the two `SkeletonText` lines inside
            // reserve the real text's line box, which doubles at 200%
            // (`accessibility` §3).
            { minHeight: densityValues.row },
            index < count - 1 && styles.rowDivider,
          ]}
        >
          <SkeletonCircle
            diameter={ROW_AVATAR}
            accessibilityLabel={index === 0 ? accessibilityLabel : undefined}
          />
          <View style={styles.rowText}>
            <SkeletonText size="label" lastLineWidth="58%" />
            <SkeletonText size="caption" lastLineWidth="34%" />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(12),
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border.soft,
  },
  rowText: {
    flex: 1,
    gap: spacing(6),
  },
  titleBlock: {
    gap: spacing(6),
  },
  cardLines: {
    gap: spacing(8),
  },
});
