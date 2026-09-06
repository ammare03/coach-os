import { waitFor } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';
import * as SplashScreen from 'expo-splash-screen';
import { act } from 'react';
import { Text } from 'react-native';

import AuthLayout from '../app/(auth)/_layout.tsx';
import ClientLayout from '../app/(client)/_layout.tsx';
import ClientOnboardingLayout from '../app/(client-onboarding)/_layout.tsx';
import CoachLayout from '../app/(coach)/_layout.tsx';
import CoachOnboardingLayout from '../app/(coach-onboarding)/_layout.tsx';
import RootLayout from '../app/_layout.tsx';
import IndexScreen from '../app/index.tsx';
import { resolveAuthGate, type AuthGateSession } from '../features/auth/AuthGate.tsx';
import type { AccessTokenRole } from '../features/auth/jwt.ts';
import { useAuthStore } from '../features/auth/store.ts';

// The four acceptance criteria of `phase-05-app-shell/providers-and-gates/03`,
// against the real root layout, the real three group layouts, and the real
// `/` route — the same reasoning as `root-layout.test.tsx`, which is why this
// file sits beside it and outside `src/app` (every file under the router root
// becomes a route).
//
// "No flash" is asserted as *never rendered*, not as *not on screen now*:
// each stand-in screen records its own invocation, so a group that painted
// for a single frame before the redirect landed still fails. Querying the
// tree afterwards could not tell the two apart, which is exactly the bug a
// `useEffect`-based redirect produces.

jest.mock('../global.css', () => ({}));
jest.mock('../lib/api-url.ts', () => ({ getApiUrl: () => 'http://localhost:3000/trpc' }));

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  hideAsync: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('expo-system-ui', () => ({
  setBackgroundColorAsync: jest.fn(() => Promise.resolve()),
}));

// The cold-start sequence is `auth-client/04`'s and has its own tests. Stubbed
// so each case can put the store in one exact state and keep it there — a real
// bootstrap would race every assertion to `'unauthenticated'`.
jest.mock('../features/auth/bootstrap.ts', () => ({ bootstrap: jest.fn(() => Promise.resolve()) }));

const mockHideAsync = jest.mocked(SplashScreen.hideAsync);

/** The `(tabs)` navigators, which this task does not touch. */
function TabsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

const rendered: string[] = [];

/** A stand-in that records the fact it rendered at all — see the note above. */
function screenRecording(label: string) {
  return function RecordedScreen() {
    rendered.push(label);
    return <Text>{label}</Text>;
  };
}

const AUTH_WELCOME = 'auth welcome';
const COACH_HOME = 'coach home';
const CLIENT_HOME = 'client home';
const COACH_ONBOARDING = 'coach onboarding';
const CLIENT_ONBOARDING = 'client onboarding';
// `client-onboarding/01` — the exempt route, and the six that are not.
const AUTH_INVITE = 'auth invite';
const AUTH_SIGN_IN = 'auth sign-in';
const AUTH_SIGN_UP = 'auth sign-up';
const AUTH_SOCIAL = 'auth complete-social-signup';
const AUTH_FORGOT = 'auth forgot-password';
const AUTH_RESET = 'auth reset-password';

function renderApp(initialUrl: string) {
  renderRouter(
    {
      _layout: RootLayout,
      index: IndexScreen,

      '(auth)/_layout': AuthLayout,
      '(auth)/welcome': screenRecording(AUTH_WELCOME),
      // The real `(auth)` layout enumerates all seven of its screens; each
      // needs a route to name or the navigator throws.
      '(auth)/sign-in': screenRecording(AUTH_SIGN_IN),
      '(auth)/sign-up': screenRecording(AUTH_SIGN_UP),
      '(auth)/complete-social-signup': screenRecording(AUTH_SOCIAL),
      '(auth)/forgot-password': screenRecording(AUTH_FORGOT),
      '(auth)/reset-password/[token]': screenRecording(AUTH_RESET),
      '(auth)/invite/[code]': screenRecording(AUTH_INVITE),

      '(coach)/_layout': CoachLayout,
      '(coach)/(tabs)/_layout': TabsLayout,
      '(coach)/(tabs)/index': screenRecording(COACH_HOME),

      '(client)/_layout': ClientLayout,
      '(client)/(tabs)/_layout': TabsLayout,
      '(client)/(tabs)/index': screenRecording(CLIENT_HOME),

      '(coach-onboarding)/_layout': CoachOnboardingLayout,
      '(coach-onboarding)/index': screenRecording(COACH_ONBOARDING),

      '(client-onboarding)/_layout': ClientOnboardingLayout,
      '(client-onboarding)/index': screenRecording(CLIENT_ONBOARDING),
    },
    { initialUrl },
  );
}

beforeEach(() => {
  rendered.length = 0;
  useAuthStore.setState({ status: 'loading', userId: null, role: null, isOnboarded: false });
});

describe('the auth gate', () => {
  it('lands an authenticated coach in (coach), with no frame of (auth) or (client)', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      userId: 'u1',
      role: 'coach',
      isOnboarded: true,
    });

    renderApp('/');

    expect(await screen.findByText(COACH_HOME)).toBeTruthy();
    expect(rendered).not.toContain(AUTH_WELCOME);
    expect(rendered).not.toContain(CLIENT_HOME);
  });

  it('lands an authenticated client in (client), with no frame of (auth) or (coach)', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      userId: 'u2',
      role: 'client',
      isOnboarded: true,
    });

    renderApp('/');

    expect(await screen.findByText(CLIENT_HOME)).toBeTruthy();
    expect(rendered).not.toContain(AUTH_WELCOME);
    expect(rendered).not.toContain(COACH_HOME);
  });

  it('lands an unauthenticated user in (auth), with no frame of either authenticated group', async () => {
    useAuthStore.setState({
      status: 'unauthenticated',
      userId: null,
      role: null,
      isOnboarded: false,
    });

    renderApp('/');

    expect(await screen.findByText(AUTH_WELCOME)).toBeTruthy();
    expect(rendered).not.toContain(COACH_HOME);
    expect(rendered).not.toContain(CLIENT_HOME);
  });

  it('renders nothing beyond the splash while the session is still loading', async () => {
    renderApp('/');

    // Nothing speculative: not the group the last session used, not (auth)
    // as a guess, nothing at all.
    await waitFor(() => expect(rendered).toEqual([]));
    // And the splash is still up, so "nothing" is not a blank screen.
    expect(mockHideAsync).not.toHaveBeenCalled();
  });

  it('turns a deep link into the other role’s group into a redirect, not a render', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      userId: 'u2',
      role: 'client',
      isOnboarded: true,
    });

    renderApp('/(coach)/(tabs)');

    expect(await screen.findByText(CLIENT_HOME)).toBeTruthy();
    expect(rendered).not.toContain(COACH_HOME);
  });

  it('keeps an unauthenticated deep link out of (coach) entirely', async () => {
    useAuthStore.setState({
      status: 'unauthenticated',
      userId: null,
      role: null,
      isOnboarded: false,
    });

    renderApp('/(coach)/(tabs)');

    expect(await screen.findByText(AUTH_WELCOME)).toBeTruthy();
    expect(rendered).not.toContain(COACH_HOME);
  });

  // `phase-06-onboarding/onboarding-infrastructure/02`'s three routing
  // criteria. Same "never rendered" standard as above: a coach who has not
  // finished setup must not see a frame of the shell on the way past it.
  it('sends a non-onboarded coach into (coach-onboarding), never the coach shell', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      userId: 'u1',
      role: 'coach',
      isOnboarded: false,
    });

    renderApp('/');

    expect(await screen.findByText(COACH_ONBOARDING)).toBeTruthy();
    expect(rendered).not.toContain(COACH_HOME);
    expect(rendered).not.toContain(CLIENT_ONBOARDING);
  });

  it('sends a non-onboarded client into (client-onboarding), never the client shell', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      userId: 'u2',
      role: 'client',
      isOnboarded: false,
    });

    renderApp('/');

    expect(await screen.findByText(CLIENT_ONBOARDING)).toBeTruthy();
    expect(rendered).not.toContain(CLIENT_HOME);
    expect(rendered).not.toContain(COACH_ONBOARDING);
  });

  // "regardless of how they navigate" (the feature's own AC) — a deep link
  // straight at the shell is the case a gate that only guarded `/` misses.
  it('turns a deep link into the shell into a redirect back to onboarding', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      userId: 'u1',
      role: 'coach',
      isOnboarded: false,
    });

    renderApp('/(coach)/(tabs)');

    expect(await screen.findByText(COACH_ONBOARDING)).toBeTruthy();
    expect(rendered).not.toContain(COACH_HOME);
  });

  it('turns an onboarded coach away from the onboarding flow', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      userId: 'u1',
      role: 'coach',
      isOnboarded: true,
    });

    renderApp('/(coach-onboarding)');

    expect(await screen.findByText(COACH_HOME)).toBeTruthy();
    expect(rendered).not.toContain(COACH_ONBOARDING);
  });

  // The task's stated risk, as a test: `me.completeOnboarding` succeeding
  // flips the store, and that alone must move the person into the shell.
  // No remount, no refetch, no relaunch — the app here is rendered once and
  // never re-rendered by the test.
  it('re-routes into the shell the moment completion flips the store', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      userId: 'u1',
      role: 'coach',
      isOnboarded: false,
    });
    renderApp('/');
    expect(await screen.findByText(COACH_ONBOARDING)).toBeTruthy();

    act(() => {
      useAuthStore.getState().setOnboarded();
    });

    expect(await screen.findByText(COACH_HOME)).toBeTruthy();
  });

  // `client-onboarding/01` — the one exemption. An authenticated caller
  // tapping an invite link must SEE the invite screen; before this, the
  // gate bounced them to their own group root and the link did nothing.
  it('lets an authenticated client stay on (auth)/invite/[code]', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      userId: 'u2',
      role: 'client',
      isOnboarded: true,
    });

    renderApp('/(auth)/invite/K4R7M8PQ');

    expect(await screen.findByText(AUTH_INVITE)).toBeTruthy();
    expect(rendered).not.toContain(CLIENT_HOME);
  });

  it('lets an authenticated coach stay on (auth)/invite/[code] too — the refusal is a screen, not a bounce', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      userId: 'u1',
      role: 'coach',
      isOnboarded: true,
    });

    renderApp('/(auth)/invite/K4R7M8PQ');

    expect(await screen.findByText(AUTH_INVITE)).toBeTruthy();
    expect(rendered).not.toContain(COACH_HOME);
  });

  it('lets a client who has not finished onboarding stay on the invite route', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      userId: 'u2',
      role: 'client',
      isOnboarded: false,
    });

    renderApp('/(auth)/invite/K4R7M8PQ');

    expect(await screen.findByText(AUTH_INVITE)).toBeTruthy();
    expect(rendered).not.toContain(CLIENT_ONBOARDING);
  });

  // The other direction, per route: the exemption widens NOTHING else in
  // `(auth)`. `reset-password/[token]` is the one that matters most — it
  // has the same "an `(auth)` route with a param" shape as the exempt one.
  it.each([
    ['/(auth)/welcome', AUTH_WELCOME],
    ['/(auth)/sign-in', AUTH_SIGN_IN],
    ['/(auth)/sign-up', AUTH_SIGN_UP],
    ['/(auth)/complete-social-signup', AUTH_SOCIAL],
    ['/(auth)/forgot-password', AUTH_FORGOT],
    ['/(auth)/reset-password/tok_123', AUTH_RESET],
  ])('still redirects an authenticated client away from %s', async (url, label) => {
    useAuthStore.setState({
      status: 'authenticated',
      userId: 'u2',
      role: 'client',
      isOnboarded: true,
    });

    renderApp(url);

    expect(await screen.findByText(CLIENT_HOME)).toBeTruthy();
    expect(rendered).not.toContain(label);
  });

  it('sends a client back to (auth) when the session ends under them', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      userId: 'u2',
      role: 'client',
      isOnboarded: true,
    });
    renderApp('/');
    expect(await screen.findByText(CLIENT_HOME)).toBeTruthy();

    act(() => {
      useAuthStore.getState().setSignedOut();
    });

    expect(await screen.findByText(AUTH_WELCOME)).toBeTruthy();
  });
});

/** An onboarded session of `role` — the ordinary case for the P05 criteria. */
function onboarded(role: AccessTokenRole | null): AuthGateSession {
  return { status: 'authenticated', role, isOnboarded: true };
}

/** The same session mid-onboarding (`users.onboarding_completed_at IS NULL`). */
function midOnboarding(role: AccessTokenRole | null): AuthGateSession {
  return { status: 'authenticated', role, isOnboarded: false };
}

describe('resolveAuthGate', () => {
  it('waits while the session is loading, whatever route is being asked for', () => {
    expect(
      resolveAuthGate({ status: 'loading', role: 'coach', isOnboarded: true }, '(coach)'),
    ).toEqual({ action: 'wait' });
    expect(
      resolveAuthGate({ status: 'loading', role: null, isOnboarded: false }, undefined),
    ).toEqual({ action: 'wait' });
  });

  it('routes an assistant coach to (coach) — an assistant is a coach (CLAUDE.md §2)', () => {
    expect(resolveAuthGate(onboarded('assistant'), undefined)).toEqual({
      action: 'redirect',
      group: '(coach)',
    });
    expect(resolveAuthGate(onboarded('assistant'), '(coach)')).toEqual({ action: 'render' });
  });

  it('falls back to (auth) for an authenticated session with no role', () => {
    expect(resolveAuthGate(onboarded(null), '(coach)')).toEqual({
      action: 'redirect',
      group: '(auth)',
    });
  });

  it('never leaves an authenticated user sitting in (auth)', () => {
    expect(resolveAuthGate(onboarded('coach'), '(auth)')).toEqual({
      action: 'redirect',
      group: '(coach)',
    });
  });

  // `onboarding-infrastructure/02`. Role picks the pair of homes,
  // `isOnboarded` picks which of the two — asserted as a table so a missing
  // combination is visible rather than merely untested.
  it.each([
    ['coach', false, '(coach-onboarding)'],
    ['coach', true, '(coach)'],
    ['assistant', false, '(coach-onboarding)'],
    ['assistant', true, '(coach)'],
    ['client', false, '(client-onboarding)'],
    ['client', true, '(client)'],
  ] as const)('sends a %s with isOnboarded=%s to %s', (role, isOnboarded, group) => {
    expect(resolveAuthGate({ status: 'authenticated', role, isOnboarded }, undefined)).toEqual({
      action: 'redirect',
      group,
    });
  });

  it('renders the onboarding group it is already on, and refuses the shell', () => {
    expect(resolveAuthGate(midOnboarding('coach'), '(coach-onboarding)')).toEqual({
      action: 'render',
    });
    expect(resolveAuthGate(midOnboarding('coach'), '(coach)')).toEqual({
      action: 'redirect',
      group: '(coach-onboarding)',
    });
  });

  it('refuses the onboarding group once onboarding is done', () => {
    expect(resolveAuthGate(onboarded('client'), '(client-onboarding)')).toEqual({
      action: 'redirect',
      group: '(client)',
    });
  });

  // Never the other role's flow, whichever way round the mismatch runs.
  it('keeps the two onboarding flows apart', () => {
    expect(resolveAuthGate(midOnboarding('client'), '(coach-onboarding)')).toEqual({
      action: 'redirect',
      group: '(client-onboarding)',
    });
    expect(resolveAuthGate(midOnboarding('coach'), '(client-onboarding)')).toEqual({
      action: 'redirect',
      group: '(coach-onboarding)',
    });
  });

  // `client-onboarding/01`'s exemption, as a pure function. It is an
  // argument rather than a route read inside the resolver, so it is
  // assertable without a navigator — and it only ever widens `(auth)`.
  it('renders an exempt (auth) route for a session that would otherwise be redirected', () => {
    expect(resolveAuthGate(onboarded('client'), '(auth)', true)).toEqual({ action: 'render' });
    expect(resolveAuthGate(midOnboarding('coach'), '(auth)', true)).toEqual({ action: 'render' });
  });

  it('redirects the same session off (auth) when the route is not exempt', () => {
    expect(resolveAuthGate(onboarded('client'), '(auth)', false)).toEqual({
      action: 'redirect',
      group: '(client)',
    });
    expect(resolveAuthGate(onboarded('client'), '(auth)')).toEqual({
      action: 'redirect',
      group: '(client)',
    });
  });

  it('cannot open a hole in any group but (auth)', () => {
    expect(resolveAuthGate(onboarded('client'), '(coach)', true)).toEqual({
      action: 'redirect',
      group: '(client)',
    });
    expect(resolveAuthGate(onboarded('client'), '(coach-onboarding)', true)).toEqual({
      action: 'redirect',
      group: '(client)',
    });
    expect(resolveAuthGate(onboarded('coach'), undefined, true)).toEqual({
      action: 'redirect',
      group: '(coach)',
    });
  });

  it('still waits on a loading session, exempt route or not', () => {
    expect(
      resolveAuthGate({ status: 'loading', role: 'client', isOnboarded: true }, '(auth)', true),
    ).toEqual({ action: 'wait' });
  });

  // Signing out mid-flow is still a sign-out: `isOnboarded` never overrides
  // status, or a half-onboarded session would outlive its own tokens.
  it('sends an unauthenticated session to (auth) from an onboarding group', () => {
    expect(
      resolveAuthGate(
        { status: 'unauthenticated', role: null, isOnboarded: false },
        '(coach-onboarding)',
      ),
    ).toEqual({ action: 'redirect', group: '(auth)' });
  });
});
