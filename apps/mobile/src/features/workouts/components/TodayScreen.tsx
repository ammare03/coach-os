import { createThemedStyles, density } from '@coachos/ui/theme';
import { useContext } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { useWeightUnit } from '../../../hooks/useWeightUnit.ts';
import { useClientTabBarInset } from '../../navigation/client/client-dock-geometry.ts';
import { useTodaySession } from '../hooks/useTodaySession.ts';

import { TodayCard } from './TodayCard.tsx';
import { TodayHeader } from './TodayHeader.tsx';

// `(client)/(tabs)/index` — Pattern F, detail read (`UI-UX.md` §UX2),
// client density.
//
// The whole screen is a header and one card, and that is the design rather
// than an unfinished version of it (`docs/screens/client-today.md`: "the
// card is the screen"). The week strip, the two quick actions and the
// "from your coach" note are each another phase's and are marked out of
// scope in `today-card/DESIGN-SPEC.md` §6.
//
// Boundaries (§5.2). The header has no data dependency for its title and
// drops its sub-line rather than failing; the card is the PRIMARY content
// boundary and is the one section allowed a full error (`UI-UX.md` §UX4.1
// rule 2); the dock is owned by `(tabs)/_layout.tsx` and never depends on
// anything here.

export interface TodayScreenProps {
  onOpenSession: (localId: string) => void;
  onViewSummary: (localId: string) => void;
  onOpenSettings: () => void;
  /** Warms the logger's data on press-in, before navigation (`UI-UX.md` §UX3.3). */
  onPrefetchSession?: ((localId: string) => void) | undefined;
  /** `today-card/04` supplies this. Absent until then — see `TodayCard`. */
  onStartAdHoc?: (() => void) | undefined;
}

export function TodayScreen({
  onOpenSession,
  onViewSummary,
  onOpenSettings,
  onPrefetchSession,
  onStartAdHoc,
}: TodayScreenProps) {
  const themed = useThemedStyles();
  const bottomInset = useClientTabBarInset();
  // Read from the context rather than through `useSafeAreaInsets()`, which
  // throws where no provider sits above it — the same degradation
  // `client-dock-geometry.ts` documents for the bottom inset.
  const topInset = useContext(SafeAreaInsetsContext)?.top ?? 0;
  const { state, header, timeZone, retry } = useTodaySession();
  const weightUnit = useWeightUnit();

  return (
    <View style={[styles.screen, themed.screen, { paddingTop: topInset }]}>
      <TodayHeader
        header={header}
        isLoading={state.kind === 'loading'}
        onOpenSettings={onOpenSettings}
      />
      <ScrollView
        testID="client-tab-screen"
        style={styles.screen}
        // Vertically centred while the hero is the only thing on the stage
        // (§3.1): the button lands in the thumb zone and the space below
        // reads as intentional. This flips to `flex-start` the day §6's
        // deferred sections land.
        // `clientTabBarInset`, not DESIGN-SPEC §2.1's literal 132: that
        // number is the prototype's own, measured on a 393x852 frame with
        // no safe-area inset, and the shared derivation expresses the same
        // requirement from the dock's real geometry plus the device's. A
        // literal here is exactly the drift `client-dock-geometry.ts`
        // exists to prevent, and `ClientTabBar.test.tsx` pins it.
        contentContainerStyle={[styles.stage, { paddingBottom: bottomInset }]}
        showsVerticalScrollIndicator={false}
      >
        <TodayCard
          state={state}
          weightUnit={weightUnit}
          timeZone={timeZone}
          onOpenSession={onOpenSession}
          onViewSummary={onViewSummary}
          onPrefetchSession={onPrefetchSession}
          onRetry={retry}
          onStartAdHoc={onStartAdHoc}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  stage: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: density.client.gutter,
  },
});

const useThemedStyles = createThemedStyles(({ colors }) => ({
  screen: {
    backgroundColor: colors.bg.DEFAULT,
  },
}));
