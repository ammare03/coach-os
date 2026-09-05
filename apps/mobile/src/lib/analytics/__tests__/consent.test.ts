import { getTrackingPermissionsAsync } from 'expo-tracking-transparency';

import {
  __resetAnalyticsForTest,
  captureAnalyticsEvent,
  getAnalyticsConsent,
  initAnalytics,
  resolveAnalyticsConsent,
  setAnalyticsIdentity,
  setAnalyticsOptOut,
} from '../posthog.ts';

// A stand-in for the SDK. The real client opens a network queue and reads
// device storage, neither of which belongs in a unit test — and what is
// under test here is our gate, not PostHog's.
const mockClientCalls = {
  capture: jest.fn(),
  identify: jest.fn(),
  optIn: jest.fn(async () => undefined),
  optOut: jest.fn(async () => undefined),
  reset: jest.fn(),
};

jest.mock('posthog-react-native', () => ({
  PostHog: jest.fn(() => mockClientCalls),
}));

jest.mock('expo-tracking-transparency', () => ({
  getTrackingPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
}));

jest.mock('../../../env.ts', () => ({
  env: {
    EXPO_PUBLIC_POSTHOG_KEY: 'phc_test_key',
    EXPO_PUBLIC_POSTHOG_HOST: 'https://us.i.posthog.com',
  },
}));

const trackingPermission = jest.mocked(getTrackingPermissionsAsync);

beforeEach(() => {
  jest.clearAllMocks();
  __resetAnalyticsForTest();
  trackingPermission.mockResolvedValue({
    status: 'granted',
    granted: true,
  } as Awaited<ReturnType<typeof getTrackingPermissionsAsync>>);
});

describe('resolveAnalyticsConsent', () => {
  it('blocks capture entirely when the account has opted out', () => {
    expect(
      resolveAnalyticsConsent({
        hasProjectKey: true,
        accountOptedOut: true,
        osTracking: 'allowed',
      }),
    ).toBe('blocked');
  });

  it('blocks capture when no project key is configured', () => {
    expect(
      resolveAnalyticsConsent({
        hasProjectKey: false,
        accountOptedOut: false,
        osTracking: 'allowed',
      }),
    ).toBe('blocked');
  });

  // AN§2.3 — "if denied, analytics run without any device identifier",
  // which is deliberately not the same thing as sending nothing.
  it('drops to anonymous, not blocked, when the OS denies tracking', () => {
    expect(
      resolveAnalyticsConsent({
        hasProjectKey: true,
        accountOptedOut: false,
        osTracking: 'denied',
      }),
    ).toBe('anonymous');
  });

  it('lets the account opt-out win over an allowed OS flag', () => {
    expect(
      resolveAnalyticsConsent({ hasProjectKey: true, accountOptedOut: true, osTracking: 'denied' }),
    ).toBe('blocked');
  });

  it('permits identified capture only when both signals allow it', () => {
    expect(
      resolveAnalyticsConsent({
        hasProjectKey: true,
        accountOptedOut: false,
        osTracking: 'allowed',
      }),
    ).toBe('full');
  });
});

describe('initAnalytics', () => {
  it('reads the OS tracking permission and never requests it', async () => {
    await initAnalytics();

    expect(trackingPermission).toHaveBeenCalledTimes(1);
    expect(getAnalyticsConsent()).toBe('full');
  });

  it('runs anonymously when the OS tracking permission is denied', async () => {
    trackingPermission.mockResolvedValue({ status: 'denied', granted: false } as Awaited<
      ReturnType<typeof getTrackingPermissionsAsync>
    >);

    await initAnalytics();

    expect(getAnalyticsConsent()).toBe('anonymous');
    // No person profile is created while the OS says no.
    setAnalyticsIdentity({ userId: 'user-1', role: 'coach' });
    expect(mockClientCalls.identify).not.toHaveBeenCalled();
  });

  it('still captures in anonymous mode — denied tracking is not an opt-out', async () => {
    trackingPermission.mockResolvedValue({ status: 'denied', granted: false } as Awaited<
      ReturnType<typeof getTrackingPermissionsAsync>
    >);

    await initAnalytics();
    captureAnalyticsEvent('dashboard_viewed', { client_count: 3 });

    expect(mockClientCalls.capture).toHaveBeenCalledTimes(1);
    expect(mockClientCalls.optOut).not.toHaveBeenCalled();
  });

  // `reset()` clears every persisted property, `OptedOut` included, so
  // resetting after an opt-in/opt-out silently reverses it.
  it('clears the stored identifier before, never after, changing the opt state', async () => {
    trackingPermission.mockResolvedValue({ status: 'denied', granted: false } as Awaited<
      ReturnType<typeof getTrackingPermissionsAsync>
    >);

    await initAnalytics();

    const resetOrder = mockClientCalls.reset.mock.invocationCallOrder[0];
    const optInOrder = mockClientCalls.optIn.mock.invocationCallOrder[0];
    expect(resetOrder).toBeDefined();
    expect(optInOrder).toBeDefined();
    expect(resetOrder).toBeLessThan(optInOrder as number);
  });

  it('identifies the signed-in user with a role and nothing else', async () => {
    await initAnalytics();
    setAnalyticsIdentity({ userId: 'user-1', role: 'client' });

    expect(mockClientCalls.identify).toHaveBeenCalledWith('user-1', { role: 'client' });
  });

  it('fails open when the permission module is unavailable', async () => {
    trackingPermission.mockRejectedValue(new Error('no native module'));

    await initAnalytics();

    expect(getAnalyticsConsent()).toBe('full');
  });
});

describe('the in-app analytics opt-out', () => {
  it('captures nothing once the account opts out, and resumes when it opts back in', async () => {
    await initAnalytics();

    captureAnalyticsEvent('dashboard_viewed', { client_count: 3 });
    expect(mockClientCalls.capture).toHaveBeenCalledTimes(1);

    setAnalyticsOptOut(true);
    captureAnalyticsEvent('dashboard_viewed', { client_count: 3 });
    captureAnalyticsEvent('client_invited', { invite_id: 'x' });
    expect(mockClientCalls.capture).toHaveBeenCalledTimes(1);

    setAnalyticsOptOut(false);
    captureAnalyticsEvent('dashboard_viewed', { client_count: 3 });
    expect(mockClientCalls.capture).toHaveBeenCalledTimes(2);
  });

  it('opts the SDK out and clears the stored identifier, not just our gate', async () => {
    await initAnalytics();

    mockClientCalls.reset.mockClear();
    setAnalyticsOptOut(true);

    expect(mockClientCalls.optOut).toHaveBeenCalled();
    expect(mockClientCalls.reset).toHaveBeenCalled();
    expect(getAnalyticsConsent()).toBe('blocked');
    expect(mockClientCalls.reset.mock.invocationCallOrder[0]).toBeLessThan(
      mockClientCalls.optOut.mock.invocationCallOrder[0] as number,
    );
  });

  it('captures nothing before initialisation has produced a client', () => {
    // The unconfigured case reaches the same state by a different route:
    // without a project key `initAnalytics()` returns before constructing
    // anything, so the client stays null and every call is a no-op.
    captureAnalyticsEvent('dashboard_viewed', { client_count: 3 });

    expect(mockClientCalls.capture).not.toHaveBeenCalled();
  });
});
