// The claim rule, tested where it is pure. Every branch of DB§14.5's
// staleness decision is reachable here without a database — the database
// half (the row lock, the two-device race, the columns actually written)
// is `../../routers/__tests__/workouts.claim.test.ts`.
import {
  CLAIM_CEILING_MS,
  CLAIM_HEARTBEAT_STALE_MS,
  CLAIM_HEARTBEAT_WRITE_MIN_MS,
  decideClaim,
  isClaimStale,
} from './claim.ts';

const NOW = new Date('2026-08-15T10:00:00.000Z');
const THIS_DEVICE = '01926b8e-0000-7000-8000-00000000000a';
const OTHER_DEVICE = '01926b8e-0000-7000-8000-00000000000b';

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

describe('the windows themselves', () => {
  // Every other test in this file and in the router's expresses its case
  // through these constants — `ago(CLAIM_HEARTBEAT_STALE_MS + 1_000)` — so
  // all of them stay green if the constants change. That makes the two
  // durations DB§14.5 actually specifies the one thing the suite cannot
  // otherwise catch, and getting either wrong is invisible: a fifteen-second
  // window steals sessions out from under a live device, and a six-minute
  // ceiling makes a mid-workout pause look abandoned.
  it('is fifteen minutes without a heartbeat, and six hours regardless of one', () => {
    expect(CLAIM_HEARTBEAT_STALE_MS).toBe(15 * 60 * 1_000);
    expect(CLAIM_CEILING_MS).toBe(6 * 60 * 60 * 1_000);
  });

  it('writes the heartbeat back far enough inside the staleness window to miss a tick', () => {
    // The throttle must never be so coarse that a device heartbeating
    // normally still ages out of its own claim.
    expect(CLAIM_HEARTBEAT_WRITE_MIN_MS).toBeLessThan(CLAIM_HEARTBEAT_STALE_MS);
  });
});

describe('isClaimStale', () => {
  it('treats a live heartbeat inside a fresh session as held', () => {
    expect(
      isClaimStale(
        { activeDeviceId: OTHER_DEVICE, claimedAt: ago(60_000), startedAt: ago(20 * 60_000) },
        NOW,
      ),
    ).toBe(false);
  });

  it('releases a claim whose device has gone quiet for 15 minutes', () => {
    const state = {
      activeDeviceId: OTHER_DEVICE,
      claimedAt: ago(CLAIM_HEARTBEAT_STALE_MS + 1_000),
      startedAt: ago(CLAIM_HEARTBEAT_STALE_MS + 1_000),
    };

    expect(isClaimStale(state, NOW)).toBe(true);
  });

  it('holds a claim exactly at the heartbeat threshold — the window is exclusive', () => {
    const state = {
      activeDeviceId: OTHER_DEVICE,
      claimedAt: ago(CLAIM_HEARTBEAT_STALE_MS),
      startedAt: ago(CLAIM_HEARTBEAT_STALE_MS),
    };

    expect(isClaimStale(state, NOW)).toBe(false);
  });

  it('releases a claim past the six-hour ceiling even while it is still heartbeating', () => {
    // The rule the heartbeat window alone cannot express: this device is
    // alive and pinging, and it has still owned the session too long.
    const state = {
      activeDeviceId: OTHER_DEVICE,
      claimedAt: ago(30_000),
      startedAt: ago(CLAIM_CEILING_MS + 60_000),
    };

    expect(isClaimStale(state, NOW)).toBe(true);
  });

  it('measures the ceiling from claimed_at when the session never recorded a start', () => {
    const state = {
      activeDeviceId: OTHER_DEVICE,
      claimedAt: ago(CLAIM_CEILING_MS + 60_000),
      startedAt: null,
    };

    expect(isClaimStale(state, NOW)).toBe(true);
  });

  it('treats a device id with no timestamp beside it as gone', () => {
    // Un-ageable, so not evidence of anything. The alternative reading —
    // that it holds forever — is the one that strands a client.
    expect(
      isClaimStale({ activeDeviceId: OTHER_DEVICE, claimedAt: null, startedAt: null }, NOW),
    ).toBe(true);
  });
});

describe('decideClaim', () => {
  const base = { deviceId: THIS_DEVICE, at: NOW, transfer: false };

  it('claims a session nobody holds', () => {
    expect(
      decideClaim({ ...base, activeDeviceId: null, claimedAt: null, startedAt: null }),
    ).toEqual({ outcome: 'claimed', write: true });
  });

  it('renews its own claim once the throttle window has passed', () => {
    expect(
      decideClaim({
        ...base,
        activeDeviceId: THIS_DEVICE,
        claimedAt: ago(CLAIM_HEARTBEAT_WRITE_MIN_MS),
        startedAt: ago(CLAIM_HEARTBEAT_WRITE_MIN_MS),
      }),
    ).toEqual({ outcome: 'renewed', write: true });
  });

  it('renews without writing while its own claim is still fresh', () => {
    // Every write here advances `workout_sessions.updated_at` to the server
    // clock, which is DB§14.3's last-write-wins basis for `status`. A
    // heartbeat that changed nothing must not move it.
    expect(
      decideClaim({
        ...base,
        activeDeviceId: THIS_DEVICE,
        claimedAt: ago(60_000),
        startedAt: ago(60_000),
      }),
    ).toEqual({ outcome: 'renewed', write: false });
  });

  it('never drags its own heartbeat backwards when a request arrives late', () => {
    expect(
      decideClaim({
        ...base,
        at: ago(10 * 60_000),
        activeDeviceId: THIS_DEVICE,
        claimedAt: NOW,
        startedAt: ago(30 * 60_000),
      }),
    ).toEqual({ outcome: 'renewed', write: false });
  });

  it('refuses a live claim held elsewhere rather than taking it', () => {
    expect(
      decideClaim({
        ...base,
        activeDeviceId: OTHER_DEVICE,
        claimedAt: ago(60_000),
        startedAt: ago(10 * 60_000),
      }),
    ).toEqual({ outcome: 'held_elsewhere', write: false });
  });

  it('takes a live claim when the client answered “Continue here”', () => {
    expect(
      decideClaim({
        ...base,
        transfer: true,
        activeDeviceId: OTHER_DEVICE,
        claimedAt: ago(60_000),
        startedAt: ago(10 * 60_000),
      }),
    ).toEqual({ outcome: 'transferred', write: true });
  });

  it('takes a stale claim with no transfer flag and therefore no sheet', () => {
    // The acceptance criterion that outranks the rest: an old phone in a
    // drawer must never cost anyone a set.
    expect(
      decideClaim({
        ...base,
        activeDeviceId: OTHER_DEVICE,
        claimedAt: ago(CLAIM_HEARTBEAT_STALE_MS + 60_000),
        startedAt: ago(CLAIM_HEARTBEAT_STALE_MS + 60_000),
      }),
    ).toEqual({ outcome: 'transferred', write: true });
  });

  it('reports a transfer rather than a renewal when the holder changes', () => {
    // The distinction the caller acts on: only a transfer has to refetch
    // server truth before the logger accepts input.
    const decision = decideClaim({
      ...base,
      transfer: true,
      activeDeviceId: OTHER_DEVICE,
      claimedAt: ago(60_000),
      startedAt: ago(60_000),
    });

    expect(decision.outcome).toBe('transferred');
  });
});
