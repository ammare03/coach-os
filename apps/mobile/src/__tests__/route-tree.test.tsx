import { readdirSync } from 'node:fs';
import path from 'node:path';

import { NOT_FOUND_COPY } from '@coachos/ui';
import { Slot, Stack } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';
import type { ComponentType } from 'react';

import { useAuthStore } from '../features/auth/store.ts';

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
  // Not in §9.1 — the two onboarding route groups. §9.1's tree predates
  // P06 and lists no onboarding flow at all; `coach-onboarding/01` records
  // the group as a deliberate, documented extension, and
  // `onboarding-infrastructure/02` builds it because the auth gate needs
  // somewhere real to send a coach or client who has not finished setup.
  // Both screens are real as of `coach-onboarding/01` and
  // `client-onboarding/02`.
  '(client-onboarding)/_layout.tsx',
  // Not in §9.1 either, and for the same reason its group is not:
  // `phase-07-exercise-and-program-authoring/guardian-consent/06`. A
  // 13–17 client who accepts an invite has an account and no way
  // through onboarding until a guardian confirms; this is the one
  // screen they can reach. It sits in this group rather than
  // `(client)` because they are, by construction, not onboarded — see
  // the route file's own comment.
  '(client-onboarding)/guardian-consent-pending.tsx',
  '(client-onboarding)/index.tsx',
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
  // Not in §9.1 — `phase-09-workout-logger/settings-shell/01` gives each
  // settings route group a Stack so every sub-screen a later phase adds
  // under `settings/` inherits a header, a title, and a back action.
  '(client)/settings/_layout.tsx',
  '(client)/settings/index.tsx',
  '(client)/workout/[sessionId].tsx',
  '(client)/workout/[sessionId]/summary.tsx',
  '(coach-onboarding)/_layout.tsx', // not in §9.1 — see the note above
  '(coach-onboarding)/index.tsx',
  '(coach)/(tabs)/_layout.tsx', // not in §9.1 — see the (client) note above
  '(coach)/(tabs)/clients.tsx',
  '(coach)/(tabs)/inbox.tsx',
  '(coach)/(tabs)/index.tsx',
  '(coach)/(tabs)/more.tsx',
  '(coach)/(tabs)/programs.tsx',
  '(coach)/_layout.tsx',
  '(coach)/checkin/[id].tsx',
  // Not in §9.1 — `phase-10-coach-review-surfaces/client-detail/01` gives
  // the client-detail group a `Tabs` navigator, which is what makes §8.3's
  // six facets one screen with one mounted tab each rather than six pushes.
  '(coach)/client/[id]/_layout.tsx',
  '(coach)/client/[id]/chat.tsx',
  '(coach)/client/[id]/checkins.tsx',
  '(coach)/client/[id]/index.tsx',
  '(coach)/client/[id]/notes.tsx',
  '(coach)/client/[id]/nutrition.tsx',
  '(coach)/client/[id]/training.tsx',
  '(coach)/client/[id]/videos.tsx',
  '(coach)/exercise-library.tsx',
  // Not in §9.1 — the two authoring routes behind the library
  // (`phase-07-exercise-and-program-authoring/exercise-library/03`). §9.1
  // lists the library itself and stops there; creating and editing a custom
  // exercise each need their own route because both are reachable by deep
  // link from a name-collision notice.
  '(coach)/exercise/[exerciseId].tsx',
  '(coach)/exercise/new.tsx',
  '(coach)/invite-client.tsx',
  '(coach)/live/[sessionId].tsx',
  '(coach)/program/[id]/day/[dayId].tsx',
  '(coach)/program/[id]/index.tsx',
  '(coach)/session/[id].tsx',
  '(coach)/settings/_layout.tsx',
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
  // Not in §9.1 — a real shipped P06 screen. §21.3 requires the medical
  // disclaimer to be reachable from settings, and it is one screen for both
  // roles, so it sits flat rather than once per group
  // (`phase-06-onboarding/onboarding-infrastructure/03`).
  'medical-disclaimer.tsx',
  // Not in §9.1 — a real shipped P03 screen (`account-lifecycle/`).
  'your-data.tsx',
  // Not in §9.1 — two real shipped P09 screens
  // (`account-actions/02`). Flat for the same reason the two above are:
  // one screen each, identical for every role, reached from both roles'
  // settings. `pending-deletion` additionally must NOT sit in a group,
  // because it is the blocking state the group gates would otherwise
  // govern.
  'delete-account.tsx',
  'pending-deletion.tsx',
].sort();

/**
 * Every placeholder this task owns, and a URL that must resolve to it. Each
 * placeholder renders its own route key as text, so the key doubles as the
 * expected on-screen string.
 */
const PLACEHOLDER_ROUTES: readonly (readonly [route: string, url: string])[] = [
  // `welcome`, `forgot-password` and `invite/[code]` were placeholders here
  // until `router-skeleton/02` composed their real screens; they moved to
  // SUBSTITUTED below for the same reason `sign-in`/`sign-up` always were.
  ['(auth)/reset-password/[token]', '/(auth)/reset-password/tok_abc'],

  // `(coach)/(tabs)/index` was a placeholder here until
  // `phase-10-coach-review-surfaces/coach-dashboard/01` composed the real
  // dashboard; it moved to SUBSTITUTED for the same reason
  // `(coach)/(tabs)/programs` did.
  ['(coach)/(tabs)/clients', '/(coach)/(tabs)/clients'],
  // `(coach)/(tabs)/programs` was a placeholder here until
  // `program-templates/01` composed the real templates list; it moved to
  // SUBSTITUTED for the same reason `(coach)/exercise-library` did.
  ['(coach)/(tabs)/inbox', '/(coach)/(tabs)/inbox'],
  // `(coach)/(tabs)/more` was a placeholder here until
  // `phase-09-workout-logger/settings-shell/02` composed the real hub. It
  // no longer renders its own route key, so — like `+not-found` — it gets
  // its own assertion at the bottom of this file instead of a row here. It
  // is NOT substituted: the hub reads no query, so it renders in this tree
  // exactly as it does on a device, and asserting that is worth more than
  // asserting a string.
  // `(coach)/client/[id]/index` was a placeholder here until
  // `phase-10-coach-review-surfaces/client-detail/01` composed the real
  // Overview tab; it moved to SUBSTITUTED for the same reason
  // `(coach)/(tabs)/index` did. The six rows below still render their own
  // route key, through the pass-through that stands in for that feature's
  // `_layout`.
  ['(coach)/client/[id]/videos', '/(coach)/client/c1/videos'],
  ['(coach)/client/[id]/checkins', '/(coach)/client/c1/checkins'],
  ['(coach)/client/[id]/chat', '/(coach)/client/c1/chat'],
  ['(coach)/client/[id]/notes', '/(coach)/client/c1/notes'],
  ['(coach)/session/[id]', '/(coach)/session/s1'],
  ['(coach)/video/[id]', '/(coach)/video/v1'],
  ['(coach)/checkin/[id]', '/(coach)/checkin/k1'],
  // `(coach)/program/[id]/index` was a placeholder here until
  // `program-builder/01` composed the real builder, and
  // `(coach)/program/[id]/day/[dayId]` until `program-builder/02` composed
  // the day screen; both moved to SUBSTITUTED for the same reason the three
  // exercise routes did.
  // `exercise-library` was a placeholder here until `exercise-library/01`
  // composed the real screen; it and the two authoring routes moved to
  // SUBSTITUTED for the same reason `(auth)/welcome` did.
  ['(coach)/invite-client', '/(coach)/invite-client'],
  ['(coach)/live/[sessionId]', '/(coach)/live/l1'],

  // `(client)/(tabs)/index` was a placeholder here until
  // `phase-09-workout-logger/today-card/01` composed the real Today
  // screen; it moved to SUBSTITUTED for the same reason
  // `(coach)/exercise-library` did.
  ['(client)/(tabs)/nutrition', '/(client)/(tabs)/nutrition'],
  ['(client)/(tabs)/progress', '/(client)/(tabs)/progress'],
  ['(client)/(tabs)/coach', '/(client)/(tabs)/coach'],
  // `(client)/workout/[sessionId]` was a placeholder here until
  // `phase-09-workout-logger/session-runtime/02` composed the real logger
  // shell, and `.../summary` until `session-summary/01` composed the real
  // summary; both moved to SUBSTITUTED for the same reason
  // `(client)/(tabs)/index` did.
  ['(client)/log-food', '/(client)/log-food'],
  ['(client)/scan', '/(client)/scan'],
  ['(client)/record-form-check', '/(client)/record-form-check'],
  ['(client)/checkin/[id]', '/(client)/checkin/k2'],
  ['(client)/live/[sessionId]', '/(client)/live/l2'],

  // `(coach-onboarding)/index` and `(client-onboarding)/index` were both
  // here until `coach-onboarding/01` and `client-onboarding/02` composed
  // their real flow shells; both moved to SUBSTITUTED for the same reason
  // `(auth)/welcome` did.

  // `+not-found` was here until `navigation-primitives/02` made it a real
  // screen. It no longer renders its own route key, so it gets its own
  // assertion at the bottom of this file instead of a row here.
];

function TestRootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

function SubstitutedScreen() {
  return null;
}

/**
 * Stands in for a substituted NESTED `_layout`. A layout replaced by
 * `SubstitutedScreen` would render nothing and take every route beneath it
 * with it; a `Slot` keeps the children resolving, which is the only thing
 * this file tests.
 */
function PassThroughLayout() {
  return <Slot />;
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
  // Real screens as of `router-skeleton/02` — same reason as the three
  // above. What each one renders is covered by its own component test in
  // `src/features/auth/`, and that they COMPOSE the right screen by
  // `src/__tests__/auth-routes.test.tsx`.
  '(auth)/welcome',
  '(auth)/forgot-password',
  '(auth)/invite/[code]',
  '_dev/gallery',
  'medical-disclaimer',
  'your-data',
  // Real as of `account-actions/02`. What each renders is covered by
  // `src/features/settings/screens/__tests__/DeleteAccountScreen.test.tsx`
  // and `src/features/auth/screens/__tests__/PendingDeletionScreen.test.tsx`.
  'delete-account',
  'pending-deletion',
  // Real screens as of `phase-06-onboarding/coach-onboarding/01` and
  // `client-onboarding/02`. What each renders is covered by
  // `src/features/onboarding/__tests__/`.
  '(coach-onboarding)/index',
  '(client-onboarding)/index',
  // Real as of `guardian-consent/06`; what it renders is covered by
  // `src/features/onboarding/__tests__/GuardianConsentPendingScreen.test.tsx`.
  '(client-onboarding)/guardian-consent-pending',
  // Real screens as of `phase-07-exercise-and-program-authoring/exercise-library/`
  // 01 and 03. All three call `exercises.*` through TanStack Query, so
  // rendering them here would need the tRPC provider `_layout` supplies and
  // this test deliberately substitutes. What each renders is covered by
  // `src/features/workouts/components/library/__tests__/`.
  '(coach)/exercise-library',
  '(coach)/exercise/new',
  '(coach)/exercise/[exerciseId]',
  // Real as of `program-builder/01` and `/02`, and the same reason again:
  // the builder reads `programs.get` and the day screen
  // `programs.days.get`, both through TanStack Query. What each renders is
  // covered by `src/features/programs/`.
  '(coach)/program/[id]/index',
  '(coach)/program/[id]/day/[dayId]',
  // Real as of `program-templates/01`, and the same reason again: the
  // templates list reads `programs.listTemplates` through TanStack Query.
  // What it renders is covered by
  // `src/features/programs/screens/__tests__/ProgramTemplatesScreen.test.tsx`.
  '(coach)/(tabs)/programs',
  // Real as of `phase-10-coach-review-surfaces/coach-dashboard/01`, and the
  // same reason again: the dashboard reads `coach.dashboard` through
  // TanStack Query. What it renders is covered by
  // `src/features/clients/components/__tests__/`.
  '(coach)/(tabs)/index',
  // Real as of `phase-10-coach-review-surfaces/client-detail/01`. The
  // Overview tab reads `coach.clients.overview` through TanStack Query, and
  // its `_layout` — the six-facet `Tabs` navigator — reads the same entry
  // for the client's name in its bar, so both need the tRPC provider this
  // test deliberately substitutes. The layout is replaced by a pass-through
  // rather than by nothing (see `routeContext`), so the five sibling tabs
  // below still resolve and render their own route key. What each renders
  // is covered by `src/features/clients/`.
  '(coach)/client/[id]/_layout',
  '(coach)/client/[id]/index',
  // Real as of `client-detail/02`. The Training tab reads
  // `coach.clients.trainingHistory` through TanStack Query, so it needs the
  // provider this tree substitutes. What it renders is covered by
  // `src/features/clients/screens/__tests__/ClientTrainingScreen.test.tsx`.
  '(coach)/client/[id]/training',
  // Real as of `client-detail/03`. The Nutrition tab reserves its cache key
  // through TanStack Query, so rendering it needs the same provider. What it
  // renders is covered by
  // `src/features/clients/screens/__tests__/ClientNutritionScreen.test.tsx`.
  '(coach)/client/[id]/nutrition',
  // Real as of `phase-09-workout-logger/today-card/01`, and the same
  // reason again: the Today screen reads `me.get`, `clientApp.coach` and
  // `workouts.upcoming` through TanStack Query, plus the local SQLite
  // mirror. What it renders is covered by
  // `src/features/workouts/components/__tests__/`.
  '(client)/(tabs)/index',
  // Real as of `phase-09-workout-logger/session-runtime/02`, and the same
  // reason again: the logger shell reads one session out of the local
  // SQLite mirror asynchronously, so it renders a header and an empty
  // body on this tree's first frame rather than its route key. What it
  // renders is covered by
  // `src/features/workouts/components/__tests__/SessionLoggerScreen.test.tsx`.
  '(client)/workout/[sessionId]',
  // Real as of `phase-09-workout-logger/session-summary/01`. Every FIGURE
  // on it comes from local SQLite, but the client's weight unit and time
  // zone come from `me.get` through TanStack Query, so rendering it here
  // would need the tRPC provider this test deliberately substitutes. What
  // it renders is covered by
  // `src/features/workouts/components/__tests__/SessionSummaryScreen.test.tsx`.
  '(client)/workout/[sessionId]/summary',
  // Real as of `phase-09-workout-logger/settings-shell/01`, and the same
  // reason again: one `SettingsScreen` for both roles, whose account header
  // reads `me.get` through TanStack Query. What it renders — the row set
  // per role, where each row navigates, and the degraded header — is
  // covered by
  // `src/features/settings/screens/__tests__/SettingsScreen.test.tsx`.
  '(coach)/settings/index',
  '(client)/settings/index',
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
      modules[route] = route.endsWith('_layout') ? PassThroughLayout : SubstitutedScreen;
    } else {
      const loaded = require(path.join(APP_DIR, file)) as { default: ComponentType };
      modules[route] = loaded.default;
    }
  }

  return modules;
}

/**
 * `providers-and-gates/03` put an `AuthGate` in each group's layout, so a
 * route only resolves for a session that belongs to its group. This test is
 * about route resolution, not about the gate — so it hands each case the
 * session that owns the URL and lets the gate agree. `(auth)` URLs are
 * reached signed out, which is also the default here and what the `/`
 * assertion below relies on.
 *
 * `onboarding-infrastructure/02` gave the gate a third dimension, so the
 * session that owns a URL now includes whether it has finished onboarding —
 * the two onboarding groups are owned by a session that has not, and every
 * other authenticated group by one that has.
 */
function signInAsOwnerOf(url: string): void {
  if (url.startsWith('/(coach-onboarding)')) {
    useAuthStore.setState({
      status: 'authenticated',
      userId: 'coach-1',
      role: 'coach',
      isOnboarded: false,
    });
  } else if (url.startsWith('/(client-onboarding)')) {
    useAuthStore.setState({
      status: 'authenticated',
      userId: 'client-1',
      role: 'client',
      isOnboarded: false,
    });
  } else if (url.startsWith('/(coach)')) {
    useAuthStore.setState({
      status: 'authenticated',
      userId: 'coach-1',
      role: 'coach',
      isOnboarded: true,
    });
  } else if (url.startsWith('/(client)')) {
    useAuthStore.setState({
      status: 'authenticated',
      userId: 'client-1',
      role: 'client',
      isOnboarded: true,
    });
  }
}

beforeEach(() => {
  useAuthStore.setState({
    status: 'unauthenticated',
    userId: null,
    role: null,
    isOnboarded: false,
  });
});

describe('the §9.1 route tree', () => {
  it('matches CLAUDE.md §9.1 file-for-file, bracket names included', () => {
    expect(routeFilesOnDisk()).toEqual(EXPECTED_ROUTE_FILES);
  });

  it('covers every placeholder route below', () => {
    const covered = new Set(PLACEHOLDER_ROUTES.map(([route]) => route));
    const uncovered = Object.keys(routeContext()).filter(
      (route) => !covered.has(route) && !SUBSTITUTED.has(route) && !route.endsWith('_layout'),
    );

    // The three non-placeholder routes, each asserted below: the coach More
    // hub, the root redirect, and the catch-all.
    expect(uncovered).toEqual(['(coach)/(tabs)/more', '+not-found', 'index']);
  });

  it.each(PLACEHOLDER_ROUTES)('renders %s at %s', (route, url) => {
    signInAsOwnerOf(url);
    renderRouter(routeContext(), { initialUrl: url });

    expect(screen.getByText(route)).toBeTruthy();
  });

  // The More tab is a real hub as of `settings-shell/02`, so it renders its
  // own first row rather than its route key. Which rows exist, where each
  // one goes, and that none of them is dead is
  // `features/navigation/coach/__tests__/MoreHub.test.tsx`; this asserts
  // only the tree's half — that the URL still resolves to the hub.
  it('renders the More hub at /(coach)/(tabs)/more', () => {
    signInAsOwnerOf('/(coach)/(tabs)/more');
    renderRouter(routeContext(), { initialUrl: '/(coach)/(tabs)/more' });

    expect(screen.getByTestId('coach-more-hub')).toBeTruthy();
  });

  it('redirects `/` into the tree rather than leaving it on +not-found', () => {
    // Asserted on the resolved pathname rather than rendered text: welcome
    // is a real screen now and is substituted above, so it renders nothing
    // of its own here.
    const router = renderRouter(routeContext(), { initialUrl: '/' });

    expect(router.getPathname()).toBe('/welcome');
  });

  // What the screen then renders, and where its recovery action goes, is
  // `not-found-route.test.tsx`. This asserts only the tree's half: that a
  // URL matching nothing still lands there.
  it('catches a URL matching no route in the tree', () => {
    renderRouter(routeContext(), { initialUrl: '/no-such-route' });

    expect(screen.getByText(NOT_FOUND_COPY.title)).toBeTruthy();
  });
});
