import { readdirSync } from 'node:fs';
import path from 'node:path';

import { Stack } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';
import type { ComponentType } from 'react';

// The verification section of `phase-05-app-shell/router-skeleton/01`, as a
// test rather than a manual pass through expo-router's dev URL bar. It
// answers the two questions that task's Risks section raises:
//
//   1. Does the tree on disk still match CLAUDE.md §9.1 file-for-file —
//      including every bracketed segment's exact name? A `[clientId]` where
//      §9.1 says `[id]` breaks typed-route inference and every later phase
//      written against the documented name, and it is discovered late.
//   2. Does every placeholder actually resolve and render at its route?
//
// Deliberately a tree test, not a screen test: each placeholder is asserted
// only to render its own route path, which is all this task builds.
//
// It sits OUTSIDE `src/app` on purpose. Every `.ts`/`.tsx` file under the
// router root is matched by expo-router's `require.context` glob and becomes
// a route — the P04 home-screen test this replaces lived in
// `src/app/__tests__/` and was shipping as `/__tests__/index.test`. A test
// file in there also drags Jest-only imports into the production bundle.

const APP_DIR = path.resolve(__dirname, '../app');

/** Every route file on disk, as posix paths relative to the expo-router root. */
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
  return files.sort();
}

/**
 * CLAUDE.md §9.1's tree, transcribed. The seven entries §9.1 does not list
 * carry a note; everything else is verbatim, and the bracket names are the
 * whole point of the comparison.
 */
const EXPECTED_ROUTE_FILES = [
  '(auth)/_layout.tsx',
  // Not in §9.1 — a real shipped P03 screen (`social-sign-in/03`).
  '(auth)/complete-social-signup.tsx',
  '(auth)/forgot-password.tsx',
  '(auth)/invite/[code].tsx',
  // Not in §9.1 — Ammar's decision, on UI-UX.md §UX1.4: the reset email from
  // `auth-server/06` is a live universal-link target, and without this route
  // it lands on `+not-found`.
  '(auth)/reset-password/[token].tsx',
  '(auth)/sign-in.tsx',
  '(auth)/sign-up.tsx',
  '(auth)/welcome.tsx',
  // Not in §9.1 — it lists the `(tabs)` group but no layout for it, and
  // without one the tab routes are loose stack screens. Bare here; tasks 03
  // and 04 give both groups their real tab configuration.
  '(client)/(tabs)/_layout.tsx',
  '(client)/(tabs)/coach.tsx',
  '(client)/(tabs)/index.tsx',
  '(client)/(tabs)/nutrition.tsx',
  '(client)/(tabs)/progress.tsx',
  '(client)/_layout.tsx',
  '(client)/checkin/[id].tsx',
  '(client)/live/[sessionId].tsx',
  '(client)/log-food.tsx',
  '(client)/record-form-check.tsx',
  '(client)/scan.tsx',
  '(client)/settings/index.tsx',
  '(client)/workout/[sessionId].tsx',
  '(client)/workout/[sessionId]/summary.tsx',
  '(coach)/(tabs)/_layout.tsx', // not in §9.1 — see the (client) note above
  '(coach)/(tabs)/clients.tsx',
  '(coach)/(tabs)/inbox.tsx',
  '(coach)/(tabs)/index.tsx',
  '(coach)/(tabs)/more.tsx',
  '(coach)/(tabs)/programs.tsx',
  '(coach)/_layout.tsx',
  '(coach)/checkin/[id].tsx',
  '(coach)/client/[id]/chat.tsx',
  '(coach)/client/[id]/checkins.tsx',
  '(coach)/client/[id]/index.tsx',
  '(coach)/client/[id]/notes.tsx',
  '(coach)/client/[id]/nutrition.tsx',
  '(coach)/client/[id]/training.tsx',
  '(coach)/client/[id]/videos.tsx',
  '(coach)/exercise-library.tsx',
  '(coach)/invite-client.tsx',
  '(coach)/live/[sessionId].tsx',
  '(coach)/program/[id]/day/[dayId].tsx',
  '(coach)/program/[id]/index.tsx',
  '(coach)/session/[id].tsx',
  '(coach)/settings/index.tsx',
  '(coach)/video/[id].tsx',
  '+native-intent.ts',
  '+not-found.tsx',
  // Not in §9.1 — P04's dev-only gallery, kept out of production bundles by
  // metro.config.js's blockList rather than by its name.
  '_dev/gallery.tsx',
  '_layout.tsx',
  // Not in §9.1 — expo-router needs a `/` or the app opens on `+not-found`.
  'index.tsx',
  // Not in §9.1 — a real shipped P03 screen (`account-lifecycle/`).
  'your-data.tsx',
].sort();

/**
 * Every placeholder this task owns, and a URL that must resolve to it. Each
 * placeholder renders its own route key as text, so the key doubles as the
 * expected on-screen string.
 */
const PLACEHOLDER_ROUTES: readonly (readonly [route: string, url: string])[] = [
  ['(auth)/welcome', '/(auth)/welcome'],
  ['(auth)/forgot-password', '/(auth)/forgot-password'],
  ['(auth)/invite/[code]', '/(auth)/invite/ABC123'],
  ['(auth)/reset-password/[token]', '/(auth)/reset-password/tok_abc'],

  ['(coach)/(tabs)/index', '/(coach)/(tabs)'],
  ['(coach)/(tabs)/clients', '/(coach)/(tabs)/clients'],
  ['(coach)/(tabs)/programs', '/(coach)/(tabs)/programs'],
  ['(coach)/(tabs)/inbox', '/(coach)/(tabs)/inbox'],
  ['(coach)/(tabs)/more', '/(coach)/(tabs)/more'],
  ['(coach)/client/[id]/index', '/(coach)/client/c1'],
  ['(coach)/client/[id]/training', '/(coach)/client/c1/training'],
  ['(coach)/client/[id]/nutrition', '/(coach)/client/c1/nutrition'],
  ['(coach)/client/[id]/videos', '/(coach)/client/c1/videos'],
  ['(coach)/client/[id]/checkins', '/(coach)/client/c1/checkins'],
  ['(coach)/client/[id]/chat', '/(coach)/client/c1/chat'],
  ['(coach)/client/[id]/notes', '/(coach)/client/c1/notes'],
  ['(coach)/session/[id]', '/(coach)/session/s1'],
  ['(coach)/video/[id]', '/(coach)/video/v1'],
  ['(coach)/checkin/[id]', '/(coach)/checkin/k1'],
  ['(coach)/program/[id]/index', '/(coach)/program/p1'],
  ['(coach)/program/[id]/day/[dayId]', '/(coach)/program/p1/day/d2'],
  ['(coach)/exercise-library', '/(coach)/exercise-library'],
  ['(coach)/invite-client', '/(coach)/invite-client'],
  ['(coach)/live/[sessionId]', '/(coach)/live/l1'],
  ['(coach)/settings/index', '/(coach)/settings'],

  ['(client)/(tabs)/index', '/(client)/(tabs)'],
  ['(client)/(tabs)/nutrition', '/(client)/(tabs)/nutrition'],
  ['(client)/(tabs)/progress', '/(client)/(tabs)/progress'],
  ['(client)/(tabs)/coach', '/(client)/(tabs)/coach'],
  ['(client)/workout/[sessionId]', '/(client)/workout/w1'],
  ['(client)/workout/[sessionId]/summary', '/(client)/workout/w1/summary'],
  ['(client)/log-food', '/(client)/log-food'],
  ['(client)/scan', '/(client)/scan'],
  ['(client)/record-form-check', '/(client)/record-form-check'],
  ['(client)/checkin/[id]', '/(client)/checkin/k2'],
  ['(client)/live/[sessionId]', '/(client)/live/l2'],
  ['(client)/settings/index', '/(client)/settings'],

  ['+not-found', '/no-such-route'],
];

function TestRootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

function SubstitutedScreen() {
  return null;
}

/**
 * Routes replaced by a stub when the router is built below. `_layout` is the
 * real provider stack — `providers-and-gates` owns it, and mounting it here
 * would test that rather than the tree. The rest are P03/P04 screens that
 * predate this tree and pull the design system in with them. Substituting
 * them keeps this a test of route resolution; they are still asserted to
 * exist, by `EXPECTED_ROUTE_FILES` above.
 */
const SUBSTITUTED = new Set([
  '_layout',
  '(auth)/sign-in',
  '(auth)/sign-up',
  '(auth)/complete-social-signup',
  '_dev/gallery',
  'your-data',
]);

/**
 * The real modules on disk, keyed the way expo-router's own `require.context`
 * keys them. Built by hand rather than handed to `renderRouter` as a
 * directory because `expo-router/testing-library`'s directory ponyfill does
 * not apply the `+native-intent` exclusion the real Metro context does, and
 * rejects the file as an invalid `+`-prefixed route.
 */
function routeContext(): Record<string, ComponentType> {
  const modules: Record<string, ComponentType> = {};

  for (const file of routeFilesOnDisk()) {
    if (file === '+native-intent.ts') continue; // a handler, not a route
    const route = file.replace(/\.tsx?$/, '');
    if (route === '_layout') {
      modules[route] = TestRootLayout;
    } else if (SUBSTITUTED.has(route)) {
      modules[route] = SubstitutedScreen;
    } else {
      const loaded = require(path.join(APP_DIR, file)) as { default: ComponentType };
      modules[route] = loaded.default;
    }
  }

  return modules;
}

describe('the §9.1 route tree', () => {
  it('matches CLAUDE.md §9.1 file-for-file, bracket names included', () => {
    expect(routeFilesOnDisk()).toEqual(EXPECTED_ROUTE_FILES);
  });

  it('covers every placeholder route below', () => {
    const covered = new Set(PLACEHOLDER_ROUTES.map(([route]) => route));
    const uncovered = Object.keys(routeContext()).filter(
      (route) => !covered.has(route) && !SUBSTITUTED.has(route) && !route.endsWith('_layout'),
    );

    // The root redirect is the one non-placeholder route, asserted below.
    expect(uncovered).toEqual(['index']);
  });

  it.each(PLACEHOLDER_ROUTES)('renders %s at %s', (route, url) => {
    renderRouter(routeContext(), { initialUrl: url });

    expect(screen.getByText(route)).toBeTruthy();
  });

  it('redirects `/` into the tree rather than leaving it on +not-found', () => {
    renderRouter(routeContext(), { initialUrl: '/' });

    expect(screen.getByText('(auth)/welcome')).toBeTruthy();
  });
});
