import { asProcedureName, asUuid } from '../events.ts';
import { captureAnalyticsEvent, getAnalyticsIdentity } from '../posthog.ts';
import { trackEvent } from '../track-event.ts';

// The capture path is mocked so these cases assert on what `trackEvent()`
// decided to send, not on PostHog's queue. `consent.test.ts` covers the
// other half — whether the client sends at all.
jest.mock('../posthog.ts', () => ({
  captureAnalyticsEvent: jest.fn(),
  getAnalyticsIdentity: jest.fn(() => null),
}));

const capture = jest.mocked(captureAnalyticsEvent);
const identity = jest.mocked(getAnalyticsIdentity);

const SESSION_ID = asUuid('018f4b0e-1c2d-7a3b-8c4d-5e6f70819293');
const EXERCISE_ID = asUuid('018f4b0e-1c2d-7a3b-8c4d-5e6f70819294');

function setDev(isDev: boolean): void {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = isDev;
}

const originalDev = (globalThis as unknown as { __DEV__: boolean }).__DEV__;

beforeEach(() => {
  jest.clearAllMocks();
  identity.mockReturnValue(null);
  setDev(false);
});

afterAll(() => {
  setDev(originalDev);
});

describe('trackEvent', () => {
  it('sends the declared properties alongside AN§3.0 base properties', () => {
    trackEvent('set_logged', {
      session_id: SESSION_ID,
      exercise_id: EXERCISE_ID,
      set_number: 3,
      is_warmup: false,
      had_rpe: true,
      was_offline: false,
      entry_ms: 84,
    });

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(
      'set_logged',
      expect.objectContaining({
        session_id: SESSION_ID,
        set_number: 3,
        had_rpe: true,
        entry_ms: 84,
        // Base properties, added by the emitter and never by the caller.
        platform: expect.any(String),
        app_version: expect.any(String),
        is_offline_queued: false,
      }),
    );
  });

  it('attaches user_id and role once an identity is set, and neither before', () => {
    trackEvent('dashboard_viewed', {
      client_count: 12,
      needs_attention_count: 3,
      load_ms: 180,
      from_cache: true,
    });
    const [, anonymous] = capture.mock.calls[0] ?? [];
    expect(anonymous).not.toHaveProperty('user_id');
    expect(anonymous).not.toHaveProperty('role');

    identity.mockReturnValue({ userId: '018f4b0e-1c2d-7a3b-8c4d-5e6f70819295', role: 'coach' });
    trackEvent('dashboard_viewed', {
      client_count: 12,
      needs_attention_count: 3,
      load_ms: 180,
      from_cache: true,
    });
    const [, identified] = capture.mock.calls[1] ?? [];
    expect(identified).toMatchObject({
      user_id: '018f4b0e-1c2d-7a3b-8c4d-5e6f70819295',
      role: 'coach',
    });
  });

  it('accepts the one machine-generated dotted path in the dictionary', () => {
    trackEvent('sync_failed', { procedure: asProcedureName('workouts.logSet'), attempts: 5 });

    expect(capture).toHaveBeenCalledWith(
      'sync_failed',
      expect.objectContaining({ procedure: 'workouts.logSet', attempts: 5 }),
    );
  });

  // The task's Verification step: a property that looks like an email must
  // not reach PostHog. In a release build it is stripped and warned about;
  // the event itself still goes, because analytics may never break a user
  // action.
  it('strips a property containing an email address in a release build', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    trackEvent('coach_note_created', {
      // Only reachable through a cast — the type rejects this outright.
      client_id: 'coach@example.com' as ReturnType<typeof asUuid>,
    });

    const [, properties] = capture.mock.calls[0] ?? [];
    expect(properties).not.toHaveProperty('client_id');
    expect(warn).toHaveBeenCalledTimes(1);
    // The key is named, the value never is (CLAUDE.md §21.1).
    expect(warn.mock.calls[0]?.[0]).toContain('client_id');
    expect(warn.mock.calls[0]?.[0]).not.toContain('coach@example.com');

    warn.mockRestore();
  });

  it.each([
    ['a media URL', 'https://cdn.coachos.app/media/abc.mp4'],
    ['free text', 'felt great today, knee twinged a bit'],
    ['a food name', 'chicken biryani'],
  ])('strips %s', (_label, value) => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    trackEvent('coach_note_created', { client_id: value as ReturnType<typeof asUuid> });

    const [, properties] = capture.mock.calls[0] ?? [];
    expect(properties).not.toHaveProperty('client_id');
  });

  it('throws in development so the call site is fixed before it ships', () => {
    setDev(true);

    expect(() =>
      trackEvent('coach_note_created', {
        client_id: 'coach@example.com' as ReturnType<typeof asUuid>,
      }),
    ).toThrow(/not a permitted analytics value/);
  });

  it('sends nothing for an event absent from ANALYTICS.md', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    // Only reachable from an untyped boundary — the union rejects it.
    (trackEvent as (name: string, properties: object) => void)('user_did_thing', {});

    expect(capture).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('keeps a non-finite number out of the payload', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    trackEvent('checkin_reviewed', { checkin_id: SESSION_ID, hours_to_review: Number.NaN });

    const [, properties] = capture.mock.calls[0] ?? [];
    expect(properties).not.toHaveProperty('hours_to_review');
    expect(properties).toHaveProperty('checkin_id');
  });
});

// ---------------------------------------------------------------------------
// The type-level guardrail (`ANALYTICS.md` AN§2.4, row 1).
//
// Every `@ts-expect-error` below is an assertion: `tsc` fails the build if
// the line it precedes stops being an error, which is exactly what would
// happen if a free-form `string` ever became a permitted property value.
// The function is never invoked — it exists to be typechecked.
// ---------------------------------------------------------------------------
function typeLevelGuardrails(): void {
  // A food name has no home in the registry, and an undeclared key is not
  // silently accepted.
  trackEvent('meal_logged', {
    meal_type: 'lunch',
    item_count: 2,
    entry_method: 'search',
    was_offline: false,
    // @ts-expect-error — AN§2.1: a food name may never reach PostHog.
    food_name: 'chicken biryani',
  });

  trackEvent('form_check_uploaded', {
    asset_id: SESSION_ID,
    duration_s: 42,
    bytes: 8_100_000,
    attempts: 1,
    resumed: true,
    // @ts-expect-error — AN§2.1: a media URL is a live credential.
    url: 'https://cdn.coachos.app/media/abc.mp4',
  });

  // @ts-expect-error — an arbitrary string is not a `Uuid`; ids must be branded.
  trackEvent('coach_note_created', { client_id: 'coach@example.com' });

  // @ts-expect-error — `note` is not a declared property of this event.
  trackEvent('coach_note_created', { client_id: SESSION_ID, note: 'watch the left knee' });

  // @ts-expect-error — an event that is not in ANALYTICS.md does not exist.
  trackEvent('user_did_thing', {});

  // @ts-expect-error — `tier` is a closed vocabulary, not free text.
  trackEvent('seat_limit_hit', { tier: 'enterprise', seats_used: 11 });

  // The `Exact<>` constraint holds for a variable too, not only for an
  // inline object literal, where TypeScript's own excess-property check
  // would have caught it.
  const bagWithABodyMetric = { angle: 'front' as const, weight_kg: 82 };
  // @ts-expect-error — AN§3.4: `angle` and nothing else. Ever.
  trackEvent('progress_photo_uploaded', bagWithABodyMetric);
}

it('keeps the compile-time guardrail assertions in the build', () => {
  expect(typeof typeLevelGuardrails).toBe('function');
});
