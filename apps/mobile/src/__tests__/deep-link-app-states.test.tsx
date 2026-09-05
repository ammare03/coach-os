import { readdirSync } from 'node:fs';
import path from 'node:path';

import { router as imperativeRouter, Stack } from 'expo-router';
import { act, renderRouter } from 'expo-router/testing-library';
import type { ComponentType } from 'react';

import { redirectSystemPath } from '../app/+native-intent.ts';
import { useAuthStore } from '../features/auth/store.ts';
import { clearPendingDeepLink } from '../features/navigation/deep-links/pending.ts';
import { PendingDeepLinkReplay } from '../features/navigation/deep-links/PendingDeepLinkReplay.tsx';

// `phase-05-app-shell/deep-linking/04`. §8.1 names three states a deep link
// must work from, and this file exercises the two that live in JavaScript:
//
//   • backgrounded — the app and its providers are already up, the role is
//     known, and `redirectSystemPath` resolves on the spot.
//   • installed but closed (cold start) — the launch URL arrives BEFORE the
//     auth bootstrap answers, so the link is parked and replayed after the
//     gate has redirected. This is the one with the race in it.
//
// The third — not installed — has no JavaScript at all: there is no app to
// route within, so it is a platform behaviour (universal link falls through
// to the web page; a scheme link no-ops) and appears at the bottom only as
// the decision it is, not as code.
//
// Mounted against the REAL group layouts, which carry the real `AuthGate`. A
// test that stubbed the gate out would pass while production lost the link to
// it, which is precisely the failure this task exists to catch.

const APP_DIR = path.resolve(__dirname, '../app');

function routeFilesOnDisk(directory = ''): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(path.join(APP_DIR, directory), { withFileTypes: true })) {
    const relative = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...routeFilesOnDisk(relative));
    } else if (/\.tsx?$/.test(entry.name)) {
      files.push(relative);
    }
  }
  return files;
}

function TestRootLayout() {
  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      {/* The production mount order (`src/app/_layout.tsx`): after the
          `<Stack>`, so the replay's effect flushes after the gate's. */}
      <PendingDeepLinkReplay />
    </>
  );
}

function StubScreen() {
  return null;
}

/** Screens that pull the design system in; irrelevant to route resolution. */
const SUBSTITUTED = new Set([
  '(auth)/sign-in',
  '(auth)/sign-up',
  '(auth)/complete-social-signup',
  '(auth)/welcome',
  '(auth)/forgot-password',
  '(auth)/invite/[code]',
  '_dev/gallery',
  'your-data',
]);

function routeContext(): Record<string, ComponentType> {
  const modules: Record<string, ComponentType> = {};
  for (const file of routeFilesOnDisk()) {
    if (file === '+native-intent.ts') continue;
    const route = file.replace(/\.tsx?$/, '');
    if (route === '_layout') {
      modules[route] = TestRootLayout;
    } else if (SUBSTITUTED.has(route)) {
      modules[route] = StubScreen;
    } else {
      const loaded = require(path.join(APP_DIR, file)) as { default: ComponentType };
      modules[route] = loaded.default;
    }
  }
  return modules;
}

beforeEach(() => {
  clearPendingDeepLink();
  useAuthStore.setState({ status: 'loading', userId: null, role: null });
});

describe('a deep link tapped while the app is backgrounded', () => {
  it.each([
    ['coach' as const, 'coachos://checkin/ch-1', '/checkin/ch-1'],
    ['client' as const, 'coachos://checkin/ch-1', '/checkin/ch-1'],
    ['coach' as const, 'coachos://session/se-1', '/session/se-1'],
    ['client' as const, 'coachos://session/se-1', '/workout/se-1'],
  ])('routes a %s straight to %s', (role, url, expected) => {
    useAuthStore.setState({ status: 'authenticated', userId: 'u1', role });

    // The session is already resolved, so resolution happens inline and
    // nothing is parked for the replay to pick up.
    const resolved = redirectSystemPath({ path: url, initial: false });
    const router = renderRouter(routeContext(), { initialUrl: resolved });

    expect(router.getPathname()).toBe(expected);
  });
});

describe('a deep link tapped while the app is installed but closed', () => {
  it.each([
    // One role-independent link and both roles of a role-dependent one —
    // this task's Verification section asks for exactly that pairing.
    ['client' as const, 'coachos://session/se-1', '/workout/se-1'],
    ['coach' as const, 'coachos://session/se-1', '/session/se-1'],
    ['coach' as const, 'coachos://client/cl-1', '/client/cl-1'],
    ['client' as const, 'coachos://checkin/ch-1', '/checkin/ch-1'],
  ])('lands a %s on %s once the bootstrap answers', async (role, url, expected) => {
    // Cold start: `getInitialURL()` reaches `+native-intent.ts` while the
    // store is still `loading`.
    const resolved = redirectSystemPath({ path: url, initial: true });
    const router = renderRouter(routeContext(), { initialUrl: resolved });

    // …and only now does the bootstrap answer, which is what makes the gate
    // redirect. Without the replay, this is where the link is lost.
    await act(async () => {
      useAuthStore.setState({ status: 'authenticated', userId: 'u1', role });
    });

    expect(router.getPathname()).toBe(expected);
  });

  it('replays only once, so a later navigation sticks', async () => {
    const resolved = redirectSystemPath({ path: 'coachos://checkin/ch-1', initial: true });
    const router = renderRouter(routeContext(), { initialUrl: resolved });

    await act(async () => {
      useAuthStore.setState({ status: 'authenticated', userId: 'u1', role: 'coach' });
    });
    expect(router.getPathname()).toBe('/checkin/ch-1');

    await act(async () => {
      imperativeRouter.navigate('/(coach)/(tabs)/clients');
    });
    // A store write that changes nothing must not re-fire the replay; one
    // that did would trap the user on the deep-link target.
    await act(async () => {
      useAuthStore.setState({ status: 'authenticated', userId: 'u2', role: 'coach' });
    });

    expect(router.getPathname()).toBe('/clients');
  });

  it('drops a parked link when the bootstrap says nobody is signed in', async () => {
    redirectSystemPath({ path: 'coachos://checkin/ch-1', initial: true });
    const router = renderRouter(routeContext(), { initialUrl: '/' });

    await act(async () => {
      useAuthStore.setState({ status: 'unauthenticated', userId: null, role: null });
    });

    // Parked links exist for the cold-start race, never for "sign in later
    // and land on it" — that would replay into whoever signs in next.
    expect(router.getPathname()).toBe('/welcome');
  });

  it('parks nothing for a link that needs no role', () => {
    expect(redirectSystemPath({ path: 'coachos://invite/ABC', initial: true })).toBe(
      '/(auth)/invite/ABC',
    );
  });
});

describe('a deep link tapped while the app is not installed', () => {
  // §8.1 lists the three states; it does not require deferred deep linking
  // (replaying the original link after a fresh install), and nothing else in
  // CLAUDE.md does either. Confirmed out of scope rather than left ambiguous,
  // per this task's AC 4 — building it needs a fingerprinting service, which
  // §21.1 would have to weigh first.
  it('holds nothing across an install', async () => {
    const router = renderRouter(routeContext(), { initialUrl: '/' });

    await act(async () => {
      useAuthStore.setState({ status: 'unauthenticated', userId: null, role: null });
    });

    expect(router.getPathname()).toBe('/welcome');
  });

  it('returns a string for a host path no route claims, rather than crashing', () => {
    const unclaimed = 'https://app.coachos.com/pricing';

    expect(redirectSystemPath({ path: unclaimed, initial: true })).toBe(unclaimed);
  });
});
