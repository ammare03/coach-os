import { Text, spacing } from '@coachos/ui';
import { StyleSheet, View } from 'react-native';

import { useCoachTabBarInset } from './coach-dock-metrics.ts';

export interface CoachTabPlaceholderProps {
  /** The route's own path, rendered verbatim so navigation can be checked by eye and by `route-tree.test.tsx`. */
  route: string;
  /** The plan directory that replaces this placeholder with the real screen. */
  ownedBy: string;
}

/**
 * What a coach tab renders until its owning phase builds it.
 *
 * Deliberately not a designed screen — `router-skeleton/03`'s Risks section
 * names "just adding a little" real content as this task's primary failure
 * mode, because P07/P10/P12/P25 would each have to delete it first. It shows
 * two things and nothing else: which route resolved, and who fills it in.
 *
 * It does carry the dock's bottom inset, though, and that part is not
 * decoration: the dock floats over the scene, so a screen that does not
 * reserve `useCoachTabBarInset()` at the bottom puts its last row under the
 * glass where it cannot be tapped (`UI-UX.md` §UX1.2). Inheriting the
 * correct behaviour is better than each owning phase rediscovering the bug.
 */
export function CoachTabPlaceholder({ route, ownedBy }: CoachTabPlaceholderProps) {
  const paddingBottom = useCoachTabBarInset();

  return (
    <View style={[styles.screen, { paddingBottom }]} testID={`coach-tab-placeholder-${route}`}>
      <Text>{route}</Text>
      <Text tone="muted">Built in {ownedBy}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing(8),
    paddingHorizontal: spacing(16),
  },
});
