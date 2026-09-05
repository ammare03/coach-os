import { readFileSync } from 'node:fs';
import path from 'node:path';

import * as analyticsBarrel from '../index.ts';
import * as posthogModule from '../posthog.ts';
import { __getAnalyticsOptionsForTest } from '../posthog.ts';

jest.mock('posthog-react-native', () => ({ PostHog: jest.fn() }));
jest.mock('expo-tracking-transparency', () => ({
  getTrackingPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
}));

const MOBILE_PACKAGE_JSON = path.join(__dirname, '../../../../package.json');

// `ANALYTICS.md` AN§2.4, row 3: a test that asserts autocapture and session
// replay are disabled in the SDK config. The task's Risks section is the
// reason it is a test and not a comment — a PostHog SDK upgrade that
// changes a default has to fail the build, not start recording.
describe('the PostHog SDK configuration', () => {
  it('disables session recording', () => {
    expect(__getAnalyticsOptionsForTest().enableSessionReplay).toBe(false);
  });

  it('configures no session-replay options at all', () => {
    expect(__getAnalyticsOptionsForTest()).not.toHaveProperty('sessionReplayConfig');
  });

  it('does not ship the native package session replay requires', () => {
    const manifest: unknown = JSON.parse(readFileSync(MOBILE_PACKAGE_JSON, 'utf8'));
    const dependencies =
      typeof manifest === 'object' && manifest !== null && 'dependencies' in manifest
        ? (manifest as { dependencies: Record<string, string> }).dependencies
        : {};

    // React Native session replay is implemented by a separate native
    // module. Its absence means recording cannot start even if every flag
    // above were flipped, and adding it would be a visible package.json
    // change plus a dev-client rebuild — never an OTA (CLAUDE.md §25.11).
    expect(dependencies).not.toHaveProperty('posthog-react-native-session-replay');
  });

  it('captures no ambient SDK events — every event we send is in ANALYTICS.md', () => {
    const options = __getAnalyticsOptionsForTest();

    expect(options.captureAppLifecycleEvents).toBe(false);
    expect(options.capturePushNotificationSubscriptions).toBe(false);
    expect(options.capturePushNotificationOpened).toBe(false);
    expect(options.disableSurveys).toBe(true);
  });

  it('collects no location and creates no anonymous person profile', () => {
    const options = __getAnalyticsOptionsForTest();

    // AN§2.1 — precise location, including IP-derived city.
    expect(options.disableGeoip).toBe(true);
    // AN§2.2 — a profile exists only for a user we deliberately identified.
    expect(options.personProfiles).toBe('identified_only');
  });

  it('starts opted out so nothing escapes before consent resolves', () => {
    expect(__getAnalyticsOptionsForTest().defaultOptIn).toBe(false);
  });
});

describe('the before_send gate', () => {
  function beforeSend() {
    const handler = __getAnalyticsOptionsForTest().before_send;
    if (typeof handler !== 'function') {
      throw new Error('before_send must be a single handler');
    }
    return handler;
  }

  beforeEach(() => {
    posthogModule.__resetAnalyticsForTest();
  });

  it('drops a queued event when consent has since been withdrawn', () => {
    // `__resetAnalyticsForTest` leaves consent at `blocked`, which is also
    // the state an opt-out produces while the SDK's own queue still holds
    // events captured a moment earlier.
    expect(beforeSend()({ event: 'dashboard_viewed', properties: { client_count: 3 } })).toBeNull();
  });

  it('passes null straight through', () => {
    expect(beforeSend()(null)).toBeNull();
  });
});

describe('the analytics module surface', () => {
  it('exports no PostHog client', () => {
    // The task's Risks section: a raw client is the single easiest way this
    // guardrail erodes, because the next feature that wants "one more
    // property type" reaches for `posthog.capture()` instead of extending
    // the registry.
    for (const value of Object.values(analyticsBarrel)) {
      expect(value).not.toHaveProperty('capture');
      expect(value).not.toHaveProperty('identify');
    }
    expect(analyticsBarrel).not.toHaveProperty('posthog');
    expect(analyticsBarrel).not.toHaveProperty('client');
  });

  it('exports exactly one capture function', () => {
    const capturers = Object.keys(analyticsBarrel).filter((name) =>
      /^(track|capture|log|record)/.test(name),
    );

    expect(capturers).toEqual(['trackEvent']);
  });
});
