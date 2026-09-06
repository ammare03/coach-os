import {
  cooldownLabel,
  cooldownRemainingMs,
  RESEND_WINDOW_MS,
} from '../useGuardianConsentResend.ts';

// `guardian-consent/04` allows 3 sends per 15 minutes. The rule is mirrored
// on the device so the fourth tap is PREVENTED rather than answered with an
// error — these are the two pure pieces of that.

const NOW = 1_800_000_000_000;

describe('cooldownRemainingMs', () => {
  it.each([0, 1, 2])('allows a send after %i in the window', (count) => {
    const sends = Array.from({ length: count }, (_, i) => NOW - i * 1000);

    expect(cooldownRemainingMs(sends, NOW)).toBe(0);
  });

  it('waits out the oldest of three sends, not the newest', () => {
    const oldest = NOW - 10 * 60 * 1000;
    const sends = [oldest, NOW - 60 * 1000, NOW];

    expect(cooldownRemainingMs(sends, NOW)).toBe(RESEND_WINDOW_MS - 10 * 60 * 1000);
  });

  it('frees a slot the moment the oldest send falls out of the window', () => {
    const sends = [NOW - RESEND_WINDOW_MS, NOW - 60 * 1000, NOW];

    expect(cooldownRemainingMs(sends, NOW)).toBe(0);
  });

  it('ignores order — a history is not guaranteed sorted', () => {
    const sends = [NOW, NOW - 10 * 60 * 1000, NOW - 60 * 1000];

    expect(cooldownRemainingMs(sends, NOW)).toBe(RESEND_WINDOW_MS - 10 * 60 * 1000);
  });

  it('counts only the three most recent when more have accumulated', () => {
    const sends = [NOW - 40 * 60 * 1000, NOW - 30 * 60 * 1000, NOW - 60 * 1000, NOW];

    // The two ancient sends are outside the window; two remain, so a third
    // is allowed.
    expect(cooldownRemainingMs(sends, NOW)).toBe(0);
  });
});

describe('cooldownLabel', () => {
  it('rounds up, so the button never promises a send it will refuse', () => {
    expect(cooldownLabel(11 * 60 * 1000 + 1)).toBe('Send again in 12 min');
  });

  it('never says "0 min"', () => {
    expect(cooldownLabel(1)).toBe('Send again in 1 min');
  });
});
