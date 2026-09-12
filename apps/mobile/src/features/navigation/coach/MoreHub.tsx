import {
  ListRow,
  ListSection,
  Text,
  density as densityTokens,
  spacing,
  type ListRowIcon,
} from '@coachos/ui';
import { useRouter, type Href } from 'expo-router';
import { Dumbbell, Settings, UserPlus } from 'lucide-react-native';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccessTokenRole } from '../../auth/jwt.ts';
import { useAuthStore } from '../../auth/store.ts';

import { useCoachTabBarInset } from './coach-dock-metrics.ts';

/**
 * What a `visibleWhen` predicate is allowed to see.
 *
 * The role, and nothing else, because that is what the two phases which
 * asked for the predicate actually need: P25 `team-seats-and-roles/05`
 * hides Billing and Team from an assistant (`role === 'assistant'`), and
 * P28 `gym-presence/03` swaps "Join a gym" for "Gym". Widening this to a
 * query result would put a network dependency in the one coach screen that
 * currently has none — see `MORE_HUB_ROWS`.
 */
export interface MoreHubContext {
  readonly role: AccessTokenRole | null;
}

export interface MoreHubRow {
  readonly label: string;
  /** A Lucide COMPONENT, never an element — `ListRow` owns the size and the colour. */
  readonly icon: ListRowIcon;
  /**
   * Typed as `Href`, so a route that does not exist is a compile error
   * rather than a dead row discovered on a device. `MoreHub.test.tsx`
   * repeats the check against the files on disk, because `Href` degrades to
   * `string` wherever `.expo/types` has not been generated (CI).
   */
  readonly route: Href;
  /** Omitted means always visible. */
  readonly visibleWhen?: (context: MoreHubContext) => boolean;
}

/**
 * The coach's practice menu — the second contract of `settings-shell`, and
 * the reason this is an array rather than three blocks of JSX.
 *
 * **Adding a row is one entry here.** Five later tasks
 * (`.claude/plan/phase-09-workout-logger/settings-shell/README.md`, the
 * More-hub table) each append one, and the test suite then checks their
 * route resolves on the day they write it rather than in review.
 *
 * **The split is the decision.** A row about the coach's *business* belongs
 * on this hub; a row about *the person* belongs in `SettingsScreen`'s
 * section map. More is not a second settings screen — eight later tasks and
 * P28's shared-account-screen design assume the split holds.
 *
 * **Three rows, because three screens exist.** Billing, Branding, Team and
 * Gym are named in the comment below and built nowhere: a Billing row today
 * would open nothing, which is a worse store-review outcome than an absent
 * row (`CLAUDE.md` §15.7, and this task's Risks).
 *
 *   Row        Route                        Owner
 *   Billing    `(coach)/settings/billing`   P20 paywall/03 (visibleWhen: root only)
 *   Branding   `(coach)/settings/branding`  P25 coach-branding/01
 *   Team       `(coach)/team`               P25 team-seats-and-roles/04
 *   Gym        `(coach)/settings/gym`       P28 gym-presence/03, join-codes-and-membership/02
 */
export const MORE_HUB_ROWS: readonly MoreHubRow[] = [
  { label: 'Settings', icon: Settings, route: '/(coach)/settings' },
  { label: 'Exercise library', icon: Dumbbell, route: '/(coach)/exercise-library' },
  { label: 'Invite a client', icon: UserPlus, route: '/(coach)/invite-client' },
];

/**
 * The rows a given session may see. Exported so the test asserts the filter
 * itself rather than a copy of it — and takes `rows` so the predicate
 * mechanism is testable today, while every shipped row still omits
 * `visibleWhen` and nothing is hidden from anyone.
 */
export function visibleMoreHubRows(
  context: MoreHubContext,
  rows: readonly MoreHubRow[] = MORE_HUB_ROWS,
): readonly MoreHubRow[] {
  return rows.filter((row) => row.visibleWhen?.(context) ?? true);
}

const DENSITY = 'coach';
const GUTTER = densityTokens[DENSITY].gutter;

/**
 * `(coach)/(tabs)/more` — the tab a coach reaches everything that is not a
 * client from.
 *
 * **No query, and deliberately so.** The hub is a static map of routes, so
 * it renders identically in a basement and on wi-fi; there is no loading
 * state, no empty state and no error state to design, because there is
 * nothing that can be loading, empty or failed. That is this task's
 * "renders offline" acceptance criterion, and it is a property of the data
 * contract rather than something the UI has to handle.
 *
 * The screen carries its own title: `(coach)/(tabs)/_layout.tsx` sets
 * `headerShown: false`, the same call `ProgramTemplatesScreen` is built
 * against.
 */
export function MoreHub() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const role = useAuthStore((state) => state.role);

  // The dock floats over the scene, so the last row sits under the glass
  // and cannot be tapped without this (`UI-UX.md` §UX1.2).
  const paddingBottom = useCoachTabBarInset();
  const rows = visibleMoreHubRows({ role });

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing(6), paddingBottom },
      ]}
      showsVerticalScrollIndicator={false}
      testID="coach-more-hub"
    >
      <Text size="h1" accessibilityRole="header">
        More
      </Text>

      <ListSection density={DENSITY}>
        {rows.map((row) => (
          <ListRow
            key={row.label}
            label={row.label}
            icon={row.icon}
            density={DENSITY}
            onPress={() => router.push(row.route)}
          />
        ))}
      </ListSection>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: GUTTER,
    gap: densityTokens[DENSITY].sectionGap,
  },
});
