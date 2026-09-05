import { Text, useTheme } from '@coachos/ui';
import { density, spacing } from '@coachos/ui/theme';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useClientTabBarInset } from './client-dock-geometry.ts';

export interface ClientTabPlaceholderProps {
  /** The tab's own name, as the dock labels it. */
  title: string;
  /** The expo-router route key, e.g. `(client)/(tabs)/nutrition`. */
  route: string;
  /** The plan folder that replaces this with the real screen. */
  ownedBy: string;
}

/**
 * What each of the four client tabs renders until the phase that owns it
 * builds the real thing. P05's README is explicit that a placeholder's worth
 * of fake content here is work P06+ has to delete first, so this shows three
 * true facts and no invented product: which tab this is, its route key, and
 * who fills it in.
 *
 * It is a `ScrollView` for one reason — it is the first consumer of
 * `useClientTabBarInset()`, so the dock's floating geometry is proven to
 * reserve space from the very first screen rather than being discovered
 * missing by whichever feature phase ships the first long list
 * (`UI-UX.md` §UX1.2).
 *
 * The route key is rendered verbatim because `src/__tests__/route-tree.test.tsx`
 * asserts on it — that test is what proves every §9.1 route still resolves.
 */
export function ClientTabPlaceholder({ title, route, ownedBy }: ClientTabPlaceholderProps) {
  const { colors } = useTheme();
  const bottomInset = useClientTabBarInset();

  return (
    <ScrollView
      testID="client-tab-screen"
      style={[styles.screen, { backgroundColor: colors.bg.DEFAULT }]}
      contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.stack}>
        <Text size="h1-client">{title}</Text>
        <Text size="body-lg" tone="muted">
          This screen is built in {ownedBy}
        </Text>
        <Text size="body-sm" tone="subtle">
          {route}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    // §1.3's client gutter — 20px, against the coach app's 16.
    paddingHorizontal: density.client.gutter,
    paddingTop: spacing(24),
  },
  stack: {
    gap: spacing(8),
  },
});
