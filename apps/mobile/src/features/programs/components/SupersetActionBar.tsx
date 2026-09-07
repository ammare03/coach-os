import { Button, GlassSurface, radius, spacing, Text } from '@coachos/ui';
import { StyleSheet, View } from 'react-native';

import { SUPERSET_BOUNDS } from '../supersets.ts';

import { ACTION_BAR_BOTTOM } from './BuilderActionBar.tsx';

// The action bar while a day is in selection mode (`program-builder/04`,
// frame 1e). Same dock, same tier-1 glass and same geometry as
// `BuilderActionBar` and `ReorderHintBar`, so the bar a coach already knows
// changes its contents rather than a new object appearing in a new place.
//
// **The button counts what it will do** — "Group 2", never a bare "Group"
// (`DESIGN.md` §10.8) — and it is inert below two selections, because a
// superset of one is not a superset (`CLAUDE.md` §26). The line beside it
// always says why: which letter is coming, or what is standing in the way.

export interface SupersetActionBarProps {
  selectedCount: number;
  /** The letter this group would take — `null` once all 26 are in use. */
  nextLetter: string | null;
  /** False while the selection is short, or has an ungrouped block sitting inside it. */
  isGroupable: boolean;
  onGroup: () => void;
  isSaving?: boolean;
  testID?: string;
}

/**
 * What the bar says, in the order the states are actually reached. Every
 * line states a fact and offers the next move; none of them tells the coach
 * they did something wrong (`COPY.md` §CO4.1, §CO6).
 */
export function supersetActionText(
  selectedCount: number,
  nextLetter: string | null,
  isGroupable: boolean,
): string {
  if (nextLetter === null) {
    return `A day can hold ${SUPERSET_BOUNDS.maxGroupsPerDay} supersets. Ungroup one to make another.`;
  }
  if (selectedCount < SUPERSET_BOUNDS.minMembers) {
    return 'Pick 2 or more, performed back to back.';
  }
  if (!isGroupable) {
    return 'A superset runs back to back. Pick exercises that sit next to each other.';
  }
  return `They’ll run back to back as superset ${nextLetter}`;
}

export function SupersetActionBar({
  selectedCount,
  nextLetter,
  isGroupable,
  onGroup,
  isSaving = false,
  testID,
}: SupersetActionBarProps) {
  const canCommit = isGroupable && nextLetter !== null && !isSaving;

  return (
    <View style={styles.dock} pointerEvents="box-none">
      <GlassSurface tier="tier1" style={styles.bar} {...(testID ? { testID } : {})}>
        <Text size="caption" tone="warm-muted" style={styles.status}>
          {supersetActionText(selectedCount, nextLetter, isGroupable)}
        </Text>
        <Button
          density="coach"
          size="md"
          disabled={!canCommit}
          onPress={onGroup}
          accessibilityLabel={`Group ${selectedCount} exercises as a superset`}
          testID="commit-superset"
        >
          {`Group ${selectedCount}`}
        </Button>
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: 0, right: 0, bottom: ACTION_BAR_BOTTOM },
  bar: {
    marginHorizontal: spacing(12),
    borderRadius: radius.full,
    paddingLeft: spacing(16),
    paddingRight: spacing(9),
    paddingVertical: spacing(9),
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(10),
  },
  status: { flex: 1, minWidth: 0 },
});
