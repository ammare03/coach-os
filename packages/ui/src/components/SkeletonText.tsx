import { View, type DimensionValue } from 'react-native';

import { fontSize, type TextSize } from '../theme/tokens.ts';

import { Skeleton } from './Skeleton.tsx';

export interface SkeletonTextProps {
  /** The `Text` size this stands in for — it reserves that size's line box exactly. */
  size?: TextSize;
  lines?: number;
  /**
   * Width of the final line, for a paragraph that should read as ragged
   * rather than as a block. Defaults to full width; `DESIGN.md` names no
   * value for it, so the call site decides.
   */
  lastLineWidth?: DimensionValue;
  /** See `Skeleton` — given to one skeleton per loading region, not to every line. */
  accessibilityLabel?: string | undefined;
  testID?: string | undefined;
}

/**
 * A line-of-text-shaped placeholder. Each line occupies the full line box
 * of the type size it stands in for (`DESIGN.md` §1.2's scale), with the
 * bar itself at the glyph height inside it — so swapping the skeleton for
 * real `Text` shifts nothing (`UI-UX.md` §UX5.4).
 *
 * The bar takes `radius.cell` (3px), which §1.4 assigns to a bar.
 */
export function SkeletonText({
  size = 'body',
  lines = 1,
  lastLineWidth = '100%',
  accessibilityLabel,
  testID,
}: SkeletonTextProps) {
  const [glyphHeight, metrics] = fontSize[size];
  const lineBox = Number.parseInt(metrics.lineHeight, 10);

  return (
    <View testID={testID}>
      {Array.from({ length: Math.max(1, lines) }, (_, index) => {
        const isLast = index === Math.max(1, lines) - 1;
        return (
          <View key={index} style={{ height: lineBox, justifyContent: 'center' }}>
            <Skeleton
              height={glyphHeight}
              width={isLast ? lastLineWidth : '100%'}
              radius="cell"
              accessibilityLabel={index === 0 ? accessibilityLabel : undefined}
            />
          </View>
        );
      })}
    </View>
  );
}
