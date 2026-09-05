import type * as Sentry from '@sentry/react-native';

import {
  __getSentryOptionsForTest,
  __resetSentryForTest,
  initSentry,
  scrubEvent,
} from '../sentry.ts';

// Declared here as well as in `jest.setup.ts` (which mocks the same module for
// every suite, for the reason documented there) because this file asserts on
// the call itself and needs the handle `jest.requireMock` returns.
//
// The factory builds its own `jest.fn()` rather than closing over one: jest
// hoists `jest.mock` above the file's imports, and `../sentry.ts` requires the
// mocked module on that very line, so a factory referencing an outer `const`
// would read it before its initialiser had run.
jest.mock('@sentry/react-native', () => ({ init: jest.fn() }));

const mockSdk = jest.requireMock('@sentry/react-native') as { init: jest.Mock };

// `type: undefined` is `ErrorEvent`'s own discriminant — a required field
// whose only valid value is `undefined`.
const baseEvent = { type: undefined } as unknown as Sentry.ErrorEvent;

beforeEach(() => {
  mockSdk.init.mockClear();
  __resetSentryForTest();
});

describe('scrubEvent — what survives', () => {
  it('keeps the fields that identify the bug', () => {
    const event = {
      ...baseEvent,
      event_id: 'evt-1',
      timestamp: 1234,
      level: 'error',
      message: 'boom',
      exception: { values: [{ type: 'Error', value: 'boom' }] },
      environment: 'production',
      platform: 'javascript',
    } as unknown as Sentry.ErrorEvent;

    expect(scrubEvent(event)).toMatchObject({
      event_id: 'evt-1',
      timestamp: 1234,
      level: 'error',
      message: 'boom',
      environment: 'production',
      platform: 'javascript',
    });
  });

  it('keeps release, dist, and debug_meta — without them a source map has nothing to bind to', () => {
    const event = {
      ...baseEvent,
      release: 'com.coachos.app@1.0.0+42',
      dist: '42',
      debug_meta: { images: [{ type: 'sourcemap', code_file: 'app:///index.bundle' }] },
    } as unknown as Sentry.ErrorEvent;

    const scrubbed = scrubEvent(event);

    expect(scrubbed.release).toBe('com.coachos.app@1.0.0+42');
    expect(scrubbed.dist).toBe('42');
    expect(scrubbed.debug_meta).toBeDefined();
  });

  it('keeps only the allowlisted tags, never anything else placed there', () => {
    const event = {
      ...baseEvent,
      tags: {
        requestId: 'req-1',
        procedure: 'workouts.logSet',
        errorCode: 'UNEXPECTED',
        clientEmail: 'client@example.com',
        clientName: 'Jordan Client',
      },
    } as unknown as Sentry.ErrorEvent;

    expect(scrubEvent(event).tags).toEqual({
      requestId: 'req-1',
      procedure: 'workouts.logSet',
      errorCode: 'UNEXPECTED',
    });
  });

  it('carries the user id only, never the rest of a User object', () => {
    const event = {
      ...baseEvent,
      user: {
        id: 'user-1',
        email: 'client@example.com',
        username: 'Jordan Client',
        ip_address: '1.2.3.4',
      },
    } as unknown as Sentry.ErrorEvent;

    const scrubbed = scrubEvent(event);

    expect(scrubbed.user).toEqual({ id: 'user-1' });
    expect(JSON.stringify(scrubbed)).not.toContain('client@example.com');
    expect(JSON.stringify(scrubbed)).not.toContain('1.2.3.4');
  });

  it('omits user entirely when the event carries none, rather than an empty object', () => {
    expect(scrubEvent(baseEvent)).not.toHaveProperty('user');
  });
});

describe('scrubEvent — the §21.1 Sensitive and Personal classes', () => {
  it('drops breadcrumbs entirely, including a signed media URL and a food name', () => {
    const event = {
      ...baseEvent,
      breadcrumbs: [
        { category: 'console', message: 'meal logged: Chicken Biryani, 640 kcal' },
        {
          category: 'fetch',
          data: {
            url: 'https://media.coachos.app/progress/abc.jpg?X-Amz-Signature=deadbeef',
          },
        },
        { category: 'touch', message: 'Touch: Bench Press 82.5 kg' },
      ],
    } as unknown as Sentry.ErrorEvent;

    const scrubbed = scrubEvent(event);

    expect(scrubbed).not.toHaveProperty('breadcrumbs');
    const serialised = JSON.stringify(scrubbed);
    expect(serialised).not.toContain('Chicken Biryani');
    expect(serialised).not.toContain('X-Amz-Signature');
    expect(serialised).not.toContain('82.5');
  });

  it('drops request context — the bearer token, cookies, and query string with it', () => {
    const event = {
      ...baseEvent,
      request: {
        url: 'https://api.coachos.app/trpc/nutrition.diary?clientId=abc',
        headers: { authorization: 'Bearer secret-token', cookie: 'session=x' },
        data: { weightKg: 82.5, injuries: 'lower back' },
      },
    } as unknown as Sentry.ErrorEvent;

    const scrubbed = scrubEvent(event);

    expect(scrubbed).not.toHaveProperty('request');
    const serialised = JSON.stringify(scrubbed);
    expect(serialised).not.toContain('secret-token');
    expect(serialised).not.toContain('lower back');
  });

  it('drops extra, attachments, and anything else a future call site invents', () => {
    const event = {
      ...baseEvent,
      extra: { bodyFatPercent: 14.2, injuries: 'lower back', mealName: 'Chicken Biryani' },
      attachments: [{ filename: 'screenshot.png', data: 'binary' }],
      modules: { 'some-package': '1.0.0' },
      somethingSentryAddsInAFutureRelease: { email: 'client@example.com' },
    } as unknown as Sentry.ErrorEvent;

    const scrubbed = scrubEvent(event);

    expect(scrubbed).not.toHaveProperty('extra');
    expect(scrubbed).not.toHaveProperty('attachments');
    expect(scrubbed).not.toHaveProperty('modules');
    expect(scrubbed).not.toHaveProperty('somethingSentryAddsInAFutureRelease');
    expect(JSON.stringify(scrubbed)).not.toContain('client@example.com');
  });

  it('keeps the device class but never the device name or unique identifier', () => {
    const event = {
      ...baseEvent,
      contexts: {
        device: {
          name: "Ammar's iPhone",
          model: 'iPhone15,2',
          family: 'iPhone',
          brand: 'Apple',
          arch: 'arm64',
          simulator: false,
          device_unique_identifier: 'F3C2-9911',
          battery_level: 62,
        },
        os: { name: 'iOS', version: '26.1', build: '23A5297i', kernel_version: 'Darwin 25.0.0' },
        app: {
          app_name: 'coach-os',
          app_version: '1.0.0',
          app_build: '42',
          app_identifier: 'com.coachos.app',
          device_app_hash: '9f2b1c',
        },
        culture: { locale: 'en-IN', timezone: 'Asia/Kolkata' },
      },
    } as unknown as Sentry.ErrorEvent;

    const scrubbed = scrubEvent(event);

    expect(scrubbed.contexts?.device).toEqual({
      model: 'iPhone15,2',
      family: 'iPhone',
      brand: 'Apple',
      arch: 'arm64',
      simulator: false,
    });
    expect(scrubbed.contexts?.os).toEqual({ name: 'iOS', version: '26.1' });
    expect(scrubbed.contexts?.app).toEqual({
      app_name: 'coach-os',
      app_version: '1.0.0',
      app_build: '42',
      app_identifier: 'com.coachos.app',
    });
    // `culture` is a locale and a timezone — not catastrophic, but not on the
    // allowlist, which is the point of an allowlist.
    expect(scrubbed.contexts).not.toHaveProperty('culture');

    const serialised = JSON.stringify(scrubbed);
    expect(serialised).not.toContain("Ammar's iPhone");
    expect(serialised).not.toContain('F3C2-9911');
    expect(serialised).not.toContain('9f2b1c');
  });

  it('omits contexts entirely when nothing in it is allowlisted', () => {
    const event = {
      ...baseEvent,
      contexts: { culture: { locale: 'en-IN' }, response: { status_code: 500 } },
    } as unknown as Sentry.ErrorEvent;

    expect(scrubEvent(event)).not.toHaveProperty('contexts');
  });

  it('is an allowlist, not a redaction — the output has no key the module did not put there', () => {
    const event = {
      ...baseEvent,
      event_id: 'evt-1',
      exception: { values: [{ type: 'Error', value: 'boom' }] },
      breadcrumbs: [{ message: 'x' }],
      request: { url: 'https://x' },
      extra: { a: 1 },
      user: { id: 'user-1', email: 'a@b.com' },
      contexts: { device: { name: 'phone' } },
      server_name: 'gym-basement',
      fingerprint: ['client@example.com'],
    } as unknown as Sentry.ErrorEvent;

    expect(Object.keys(scrubEvent(event)).sort()).toEqual([
      'event_id',
      'exception',
      'tags',
      'type',
      'user',
    ]);
  });
});

describe('the Sentry SDK configuration', () => {
  it('never attaches a screenshot or a view hierarchy — every CoachOS screen can be a progress photo', () => {
    const options = __getSentryOptionsForTest();
    expect(options.attachScreenshot).toBe(false);
    expect(options.attachViewHierarchy).toBe(false);
  });

  it('records no session replay', () => {
    const options = __getSentryOptionsForTest();
    expect(options.replaysSessionSampleRate).toBe(0);
    expect(options.replaysOnErrorSampleRate).toBe(0);
  });

  it('sends no PII on the SDK integrations own initiative', () => {
    expect(__getSentryOptionsForTest().sendDefaultPii).toBe(false);
  });

  it('collects no breadcrumbs at all, so none can be synced down to the native SDKs', () => {
    const options = __getSentryOptionsForTest();
    expect(options.beforeBreadcrumb?.({ message: 'meal logged: Chicken Biryani' })).toBeNull();
  });

  it('samples no traces and no profiles — the shared 5,000-events/month budget (CLAUDE.md §3.4.3)', () => {
    const options = __getSentryOptionsForTest();
    expect(options.tracesSampleRate).toBe(0);
    expect(options.profilesSampleRate).toBe(0);
  });

  it('sets no global sampleRate — a fractional rate would drop genuine crashes too', () => {
    expect(__getSentryOptionsForTest()).not.toHaveProperty('sampleRate');
  });

  it('does not turn expected connectivity failures into crash reports', () => {
    const options = __getSentryOptionsForTest();
    expect(options.enableCaptureFailedRequests).toBe(false);
    expect(options.ignoreErrors).toContain('Network request failed');
  });

  it('routes every outbound event through the scrubber', () => {
    expect(__getSentryOptionsForTest().beforeSend).toBe(scrubEvent);
  });

  it('has no DSN in a test run, which is what makes every capture a no-op', () => {
    expect(__getSentryOptionsForTest().dsn).toBeUndefined();
  });

  it('is frozen — there is no seam through which a caller changes one of these', () => {
    expect(Object.isFrozen(__getSentryOptionsForTest())).toBe(true);
  });
});

describe('initSentry', () => {
  it('initialises the SDK once, however many times it is called', () => {
    initSentry();
    initSentry();
    expect(mockSdk.init).toHaveBeenCalledTimes(1);
  });

  it('hands the SDK a mutable copy — Sentry.init assigns its own defaults onto it', () => {
    initSentry();
    const passed: unknown = mockSdk.init.mock.calls[0]?.[0];
    expect(Object.isFrozen(passed)).toBe(false);
    expect(passed).toMatchObject({ attachScreenshot: false, tracesSampleRate: 0 });
  });
});
