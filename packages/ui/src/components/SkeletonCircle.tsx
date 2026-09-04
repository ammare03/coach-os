import { Skeleton } from './Skeleton.tsx';

export interface SkeletonCircleProps {
  /** Defaults to `DESIGN.md` §9's list-row avatar. Pass `Avatar`'s diameter when standing in for one. */
  diameter?: number;
  /** See `Skeleton` — given to one skeleton per loading region, not to every shape. */
  accessibilityLabel?: string | undefined;
  testID?: string | undefined;
}

/**
 * An avatar-shaped placeholder. Takes a diameter rather than `Avatar`'s
 * size ladder so it can also stand in for the 36px row avatar `DESIGN.md`
 * §9 specifies, which is not on that ladder.
 */
export function SkeletonCircle({ diameter = 36, accessibilityLabel, testID }: SkeletonCircleProps) {
  return (
    <Skeleton
      width={diameter}
      height={diameter}
      radius="full"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    />
  );
}
