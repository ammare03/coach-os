import { NotFoundState, createThemedStyles } from '@coachos/ui';
import { useRouter, type Href } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';

import { resolveAuthGate, type RouteGroup } from '../features/auth/AuthGate.tsx';
import { useAuthStore } from '../features/auth/store.ts';

// expo-router's catch-all — a URL matching no route in the §9.1 tree
// (`phase-05-app-shell/navigation-primitives/02`). Composition only
// (`code-conventions` §1): the visual is P04's already-built
// `NotFoundState`, which is `DESIGN.md` §9's empty state.
//
// ⚠️ DERIVED, NOT DRAWN, in the sense `WelcomeScreen` records: this screen
// is not one of `DESIGN.md` §11's thirteen and appears in no prototype.
// Nothing here invents a treatment — `NotFoundState` for the block,
// `bg.DEFAULT` for the canvas, and no new values.

/**
 * Where "go home" goes per route group, and the label that names that
 * destination honestly rather than the component's default "Go back" —
 * this action replaces, it does not pop.
 *
 * `AuthGate`'s `GROUP_ROOT` is module-private, so the three hrefs are
 * restated here for the same reason `link-table.ts` restates `groupForRole`:
 * the two answers being equal is asserted in this route's test rather than
 * achieved by coupling. The role → group half is **not** restated —
 * `resolveAuthGate` is imported, so "an assistant coach is a coach"
 * (`CLAUDE.md` §2) is decided in exactly one place.
 */
const HOME = {
  '(auth)': { href: '/(auth)/welcome', label: 'Back to sign in' },
  '(coach)': { href: '/(coach)/(tabs)', label: 'Back to home' },
  '(client)': { href: '/(client)/(tabs)', label: 'Back to today' },
} as const satisfies Record<RouteGroup, { href: Href; label: string }>;

export default function NotFoundScreen() {
  const router = useRouter();
  const status = useAuthStore((state) => state.status);
  const role = useAuthStore((state) => state.role);
  const themed = useThemedStyles();

  // `undefined` group — `+not-found` belongs to no group, which is the case
  // `resolveAuthGate` already answers for `/`. It returns `wait` only while
  // the session is unresolved, and an unresolved session belongs in (auth).
  const decision = resolveAuthGate(status, role, undefined);
  const home = HOME[decision.action === 'redirect' ? decision.group : '(auth)'];

  return (
    // Scrolls rather than centres in a fixed box so the block still reaches
    // its action at 200% text (`accessibility` §3).
    <ScrollView style={[styles.screen, themed.screen]} contentContainerStyle={styles.content}>
      <NotFoundState
        recoverLabel={home.label}
        // `replace`, never `push`: the URL that matched nothing must not stay
        // on the stack for Back to return to.
        onRecover={() => router.replace(home.href)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center' },
});

const useThemedStyles = createThemedStyles((theme) => ({
  screen: { backgroundColor: theme.colors.bg.DEFAULT },
}));
