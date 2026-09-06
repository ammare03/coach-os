// `guardian-consent/06` Approach step 3 — the two actions, and the reason
// the rate limit is a disabled button rather than an error.
//
// `guardian-consent/04` allows 3 sends per 15 minutes per user. A minor
// tapping "send it again" four times is the EXPECTED behaviour on this
// screen, not abuse: they are standing next to a parent saying "I haven't
// got it". Letting the fourth tap fire and answering it with an error is
// the design that turns an ordinary moment into a rejection. So the limit
// is mirrored on the device and shown as a wait on the control itself —
// the tap is prevented, never punished.
//
// The mirror is a courtesy, not a control. The server's limit is the real
// one; when the two disagree (an app restart drops this history, or a
// second device sent too) a `RATE_LIMITED` rejection arms the same cooldown
// from the server's own `retryAfterSeconds`, and the button tells the truth
// from then on.
import { useCallback, useEffect, useState } from 'react';

import { trackEvent } from '../../lib/analytics/index.ts';
import { getRateLimitInfo } from '../../lib/rate-limit-handling.ts';
import { api } from '../../lib/trpc.ts';

/** `resend-guardian-consent.ts`'s `RESEND_MAX`, and the window its key builder carries. */
export const RESEND_MAX = 3;
export const RESEND_WINDOW_MS = 15 * 60 * 1000;

/** Four ticks a minute — a per-minute tick would round badly against a 15-minute window. */
const TICK_MS = 15_000;

/**
 * Milliseconds until another send is allowed, given the timestamps of the
 * sends already made. `0` means "allowed now".
 *
 * Pure and exported: it is the whole of the rule, and the part worth
 * asserting without a renderer.
 */
export function cooldownRemainingMs(sentAt: readonly number[], now: number): number {
  const inWindow = sentAt.filter((at) => now - at < RESEND_WINDOW_MS).sort((a, b) => a - b);
  if (inWindow.length < RESEND_MAX) {
    return 0;
  }
  // The oldest send still inside the window is the one whose expiry frees a slot.
  const oldest = inWindow[inWindow.length - RESEND_MAX];
  return oldest === undefined ? 0 : Math.max(0, oldest + RESEND_WINDOW_MS - now);
}

/** "Send again in 12 min" — never a raw seconds count, and never "0 min". */
export function cooldownLabel(remainingMs: number): string {
  return `Send again in ${Math.max(1, Math.ceil(remainingMs / 60_000))} min`;
}

export interface GuardianConsentResend {
  /** No argument resends to the address on file; an address corrects it and sends, in one call. */
  resend: (guardianEmail?: string) => void;
  isSending: boolean;
  /** `0` when a send is allowed. Drives both the disabled state and its label. */
  cooldownMs: number;
  /** True from a successful send until the next attempt — the screen's confirmation strip. */
  hasJustSent: boolean;
}

export function useGuardianConsentResend(): GuardianConsentResend {
  const mutation = api.invites.resendGuardianConsent.useMutation();
  const utils = api.useUtils();
  const [sentAt, setSentAt] = useState<readonly number[]>([]);
  const [serverCooldownUntil, setServerCooldownUntil] = useState(0);
  const [hasJustSent, setHasJustSent] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const cooldownMs = Math.max(cooldownRemainingMs(sentAt, now), serverCooldownUntil - now);
  const isCoolingDown = cooldownMs > 0;

  // Runs only while a cooldown is running, and stops the moment it ends.
  // A permanent interval on a screen whose whole job is to wait is exactly
  // the §19 battery cost this feature is meant to avoid. `isCoolingDown`
  // rather than `cooldownMs` as the dependency, so the interval is not torn
  // down and rebuilt on every tick.
  useEffect(() => {
    if (!isCoolingDown) {
      return;
    }
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [isCoolingDown]);

  const { mutate } = mutation;

  const resend = useCallback(
    (guardianEmail?: string) => {
      const at = Date.now();
      setNow(at);
      if (cooldownRemainingMs(sentAt, at) > 0 || serverCooldownUntil > at) {
        // Unreachable through the UI, where the control is disabled — but
        // the rule then holds for any future caller too.
        return;
      }
      setHasJustSent(false);
      mutate(guardianEmail === undefined ? {} : { guardianEmail }, {
        onSuccess: () => {
          setSentAt((previous) => [...previous, at]);
          setHasJustSent(true);
          // A correction changed `users.guardian_email`, so the masked
          // value this screen renders has to be re-read rather than
          // guessed at from the input.
          void utils.me.get.invalidate();
          // IDs and counts only (§20). Never the address, never the
          // birthdate — `address_changed` carries only whether a correction
          // was made, which is the funnel fact worth having.
          trackEvent('guardian_consent_resend_requested', {
            address_changed: guardianEmail !== undefined,
          });
        },
        onError: (error) => {
          const info = getRateLimitInfo(error);
          if (info) {
            setServerCooldownUntil(Date.now() + info.retryAfterSeconds * 1000);
          }
        },
      });
    },
    [mutate, sentAt, serverCooldownUntil, utils],
  );

  return { resend, isSending: mutation.isPending, cooldownMs, hasJustSent };
}
