import { waitFor } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';
import * as SplashScreen from 'expo-splash-screen';
import { act } from 'react';
import { Text } from 'react-native';

import AuthLayout from '../app/(auth)/_layout.tsx';
import ClientLayout from '../app/(client)/_layout.tsx';
import CoachLayout from '../app/(coach)/_layout.tsx';
import RootLayout from '../app/_layout.tsx';
import IndexScreen from '../app/index.tsx';
import { resolveAuthGate } from '../features/auth/AuthGate.tsx';
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

const empty = () => null;

function renderApp(initialUrl: string) {
  renderRouter(
    {
      _layout: RootLayout,
      index: IndexScreen,

      '(auth)/_layout': AuthLayout,
      '(auth)/welcome': screenRecording(AUTH_WELCOME),
      // The real `(auth)` layout enumerates all seven of its screens; each
      // needs a route to name or the navigator throws.
      '(auth)/sign-in': empty,
      '(auth)/sign-up': empty,
      '(auth)/complete-social-signup': empty,
      '(auth)/forgot-password': empty,
      '(auth)/reset-password/[token]': empty,
      '(auth)/invite/[code]': empty,

      '(coach)/_layout': CoachLayout,
      '(coach)/(tabs)/_layout': TabsLayout,
      '(coach)/(tabs)/index': screenRecording(COACH_HOME),

      '(client)/_layout': ClientLayout,
      '(client)/(tabs)/_layout': TabsLayout,
      '(client)/(tabs)/index': screenRecording(CLIENT_HOME),
    },
    { initialUrl },
  );
}

beforeEach(() => {
  rendered.length = 0;
  useAuthStore.setState({ status: 'loading', userId: null, role: null });
});

describe('the auth gate', () => {
  it('lands an authenticated coach in (coach), with no frame of (auth) or (client)', async () => {
    useAuthStore.setState({ status: 'authenticated', userId: 'u1', role: 'coach' });

    renderApp('/');

    expect(await screen.findByText(COACH_HOME)).toBeTruthy();
    expect(rendered).not.toContain(AUTH_WELCOME);
    expect(rendered).not.toContain(CLIENT_HOME);
  });

  it('lands an authenticated client in (client), with no frame of (auth) or (coach)', async () => {
    useAuthStore.setState({ status: 'authenticated', userId: 'u2', role: 'client' });

    renderApp('/');

    expect(await screen.findByText(CLIENT_HOME)).toBeTruthy();
    expect(rendered).not.toContain(AUTH_WELCOME);
    expect(rendered).not.toContain(COACH_HOME);
  });

  it('lands an unauthenticated user in (auth), with no frame of either authenticated group', async () => {
    useAuthStore.setState({ status: 'unauthenticated', userId: null, role: null });

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
    useAuthStore.setState({ status: 'authenticated', userId: 'u2', role: 'client' });

    renderApp('/(coach)/(tabs)');

    expect(await screen.findByText(CLIENT_HOME)).toBeTruthy();
    expect(rendered).not.toContain(COACH_HOME);
  });

  it('keeps an unauthenticated deep link out of (coach) entirely', async () => {
    useAuthStore.setState({ status: 'unauthenticated', userId: null, role: null });

    renderApp('/(coach)/(tabs)');

    expect(await screen.findByText(AUTH_WELCOME)).toBeTruthy();
    expect(rendered).not.toContain(COACH_HOME);
  });

  it('sends a client back to (auth) when the session ends under them', async () => {
    useAuthStore.setState({ status: 'authenticated', userId: 'u2', role: 'client' });
    renderApp('/');
    expect(await screen.findByText(CLIENT_HOME)).toBeTruthy();

    act(() => {
      useAuthStore.getState().setSignedOut();
    });

    expect(await screen.findByText(AUTH_WELCOME)).toBeTruthy();
  });
});

describe('resolveAuthGate', () => {
  it('waits while the session is loading, whatever route is being asked for', () => {
    expect(resolveAuthGate('loading', 'coach', '(coach)')).toEqual({ action: 'wait' });
    expect(resolveAuthGate('loading', null, undefined)).toEqual({ action: 'wait' });
  });

  it('routes an assistant coach to (coach) — an assistant is a coach (CLAUDE.md §2)', () => {
    expect(resolveAuthGate('authenticated', 'assistant', undefined)).toEqual({
      action: 'redirect',
      group: '(coach)',
    });
    expect(resolveAuthGate('authenticated', 'assistant', '(coach)')).toEqual({ action: 'render' });
  });

  it('falls back to (auth) for an authenticated session with no role', () => {
    expect(resolveAuthGate('authenticated', null, '(coach)')).toEqual({
      action: 'redirect',
      group: '(auth)',
    });
  });

  it('never leaves an authenticated user sitting in (auth)', () => {
    expect(resolveAuthGate('authenticated', 'coach', '(auth)')).toEqual({
      action: 'redirect',
      group: '(coach)',
    });
  });
});
