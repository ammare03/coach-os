// Pure — no Redis, no Postgres. `testing` skill §3: everything in this file
// runs in well under 10 seconds and needs nothing running.
import { keys, type RedisKey } from '../lib/redis-keys.ts';

// `jest.setup-env.ts` sets this to 'coachos:test:' before `env.ts` parses
// `process.env`.
const PREFIX = 'coachos:test:';

function expectValidKey(result: RedisKey, expectedKey: string) {
  expect(result.key).toBe(`${PREFIX}${expectedKey}`);
  expect(Number.isInteger(result.ttlSeconds)).toBe(true);
  expect(result.ttlSeconds).toBeGreaterThan(0);
}

describe('keys', () => {
  it('session', () => {
    expectValidKey(keys.session('user-1', 'device-1'), 'sess:user-1:device-1');
    expect(keys.session('user-1', 'device-1').ttlSeconds).toBe(15 * 60);
  });

  it('entitlements', () => {
    expectValidKey(keys.entitlements('coach-1'), 'entitlements:coach-1');
    expect(keys.entitlements('coach-1').ttlSeconds).toBe(5 * 60);
  });

  it('rateLimit — TTL is the caller-supplied window, not a number this module owns', () => {
    expectValidKey(keys.rateLimit('workouts.logSet', 'user-1', 60), 'rl:workouts.logSet:user-1');
    expect(keys.rateLimit('workouts.logSet', 'user-1', 60).ttlSeconds).toBe(60);
    expect(keys.rateLimit('auth.signIn', 'user-1', 900).ttlSeconds).toBe(900);
  });

  it('rateLimitAuth', () => {
    expectValidKey(keys.rateLimitAuth('203.0.113.5'), 'rl:auth:203.0.113.5');
    expect(keys.rateLimitAuth('203.0.113.5').ttlSeconds).toBe(15 * 60);
  });

  // `guardian-consent/01` — 7 days, two orders of magnitude above `pwreset`:
  // the person who opens this link is a parent reading their email that
  // evening, the next day, or after the weekend.
  it('guardianConsent', () => {
    expectValidKey(keys.guardianConsent('abc123hash'), 'guardianconsent:abc123hash');
    expect(keys.guardianConsent('abc123hash').ttlSeconds).toBe(7 * 24 * 60 * 60);
  });

  // `guardian-consent/04` — the reverse pointer that makes a mistyped
  // address correctable: same 7-day TTL as the token it names.
  it('guardianConsentOutstanding', () => {
    expectValidKey(keys.guardianConsentOutstanding('user-1'), 'guardianconsent:user:user-1');
    expect(keys.guardianConsentOutstanding('user-1').ttlSeconds).toBe(7 * 24 * 60 * 60);
  });

  // Deliberately not `rl:invites.resendGuardianConsent:{userId}` — that key
  // already belongs to the structural 600/min default tier, and two limits
  // sharing one counter would fight over its TTL.
  it('rateLimitGuardianConsentResend', () => {
    expectValidKey(
      keys.rateLimitGuardianConsentResend('user-1'),
      'rl:guardianConsentResend:user-1',
    );
    expect(keys.rateLimitGuardianConsentResend('user-1').ttlSeconds).toBe(15 * 60);
  });

  // The destination axis. The argument is a hash, and the assertion below
  // is what stops it silently becoming an address.
  it('rateLimitGuardianConsentEmail', () => {
    expectValidKey(
      keys.rateLimitGuardianConsentEmail('abc123hash'),
      'rl:guardianConsentResend.email:abc123hash',
    );
    expect(keys.rateLimitGuardianConsentEmail('abc123hash').ttlSeconds).toBe(15 * 60);
    expect(keys.rateLimitGuardianConsentEmail('abc123hash').key).not.toContain('@');
  });

  it('presence', () => {
    expectValidKey(keys.presence('conversation-1'), 'presence:conversation-1');
    expect(keys.presence('conversation-1').ttlSeconds).toBe(60);
  });

  it('typing', () => {
    expectValidKey(keys.typing('conversation-1', 'user-1'), 'typing:conversation-1:user-1');
    expect(keys.typing('conversation-1', 'user-1').ttlSeconds).toBe(5);
  });

  it('dashboard', () => {
    expectValidKey(keys.dashboard('coach-1'), 'dash:coach-1');
    expect(keys.dashboard('coach-1').ttlSeconds).toBe(60);
  });

  it('foodQuery', () => {
    expectValidKey(keys.foodQuery('abc123hash'), 'food:q:abc123hash');
    expect(keys.foodQuery('abc123hash').ttlSeconds).toBe(24 * 60 * 60);
  });

  it('signedUrl', () => {
    expectValidKey(keys.signedUrl('asset-1', 'user-1'), 'signedurl:asset-1:user-1');
    expect(keys.signedUrl('asset-1', 'user-1').ttlSeconds).toBe(55 * 60);
  });

  it('summaryLock', () => {
    expectValidKey(keys.summaryLock('client-1', '2026-08-23'), 'lock:summary:client-1:2026-08-23');
    expect(keys.summaryLock('client-1', '2026-08-23').ttlSeconds).toBe(10);
  });

  it('every builder applies the environment prefix', () => {
    const results = [
      keys.session('a', 'b'),
      keys.entitlements('a'),
      keys.rateLimit('a', 'b', 60),
      keys.rateLimitAuth('a'),
      keys.presence('a'),
      keys.typing('a', 'b'),
      keys.dashboard('a'),
      keys.foodQuery('a'),
      keys.guardianConsent('a'),
      keys.guardianConsentOutstanding('a'),
      keys.rateLimitGuardianConsentResend('a'),
      keys.rateLimitGuardianConsentEmail('a'),
      keys.signedUrl('a', 'b'),
      keys.summaryLock('a', 'b'),
    ];
    for (const { key } of results) {
      expect(key.startsWith(PREFIX)).toBe(true);
    }
  });
});
