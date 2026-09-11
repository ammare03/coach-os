import { Metric } from '@coachos/ui';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

// The header's right-hand slot: how long this session has been running.
//
// Its own component, and its own state, for one reason: it re-renders every
// second, and everything else on this screen must not. Mounted inside
// `LoggerHeader` it costs one line of text per tick; folded into the header
// or the screen it would re-render the session name, the set counts and —
// once task 03 lands — the exercise list under a client's thumb
// (`frontend-performance` §3, `CLAUDE.md` §19's ≥55fps and battery
// budgets).
//
// **The value is derived, never accumulated.** Each tick recomputes
// `now − startedAt` rather than incrementing a counter, so a session
// backgrounded for twenty minutes reads twenty minutes longer when the app
// comes back. An accumulating counter is wrong by exactly however long the
// OS throttled the timer, which on Android is most of it — and this is the
// one number a client checks against the gym clock.

const SECOND_MS = 1000;
const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 3600;

/**
 * `0:09` · `18:48` · `1:02:14`.
 *
 * Minutes are not zero-padded and seconds always are, which is how a clock
 * reads; the hours segment appears only once there is one, rather than
 * making every session pay two characters for a case almost none reach.
 */
export function formatElapsed(seconds: number): string {
  // A device clock that moved backwards. Not worth a state — clamp it.
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / HOUR_SECONDS);
  const minutes = Math.floor((total % HOUR_SECONDS) / MINUTE_SECONDS);
  const rest = total % MINUTE_SECONDS;
  const pad = (value: number) => String(value).padStart(2, '0');

  return hours === 0
    ? `${String(minutes)}:${pad(rest)}`
    : `${String(hours)}:${pad(minutes)}:${pad(rest)}`;
}

/**
 * The same interval in words. A screen reader announcing "eighteen colon
 * forty-eight" is announcing punctuation, not a duration (`accessibility`
 * §2 — a stat carries its value *and* its unit).
 */
export function spokenElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / HOUR_SECONDS);
  const minutes = Math.floor((total % HOUR_SECONDS) / MINUTE_SECONDS);
  const rest = total % MINUTE_SECONDS;
  const plural = (value: number, noun: string) =>
    `${String(value)} ${noun}${value === 1 ? '' : 's'}`;

  const segments = hours === 0 ? [] : [plural(hours, 'hour')];
  segments.push(plural(minutes, 'minute'), plural(rest, 'second'));
  return `Elapsed ${segments.join(' ')}`;
}

export interface SessionElapsedProps {
  startedAt: Date;
  /** Freezes the clock. Injected so the value is testable; never passed in the app. */
  now?: Date | undefined;
}

export function SessionElapsed({ startedAt, now }: SessionElapsedProps) {
  const frozen = now !== undefined;
  const [tickAt, setTickAt] = useState(() => (now ?? new Date()).getTime());

  useEffect(() => {
    if (frozen) return;
    const timer = setInterval(() => setTickAt(Date.now()), SECOND_MS);
    return () => clearInterval(timer);
  }, [frozen]);

  const at = frozen && now ? now.getTime() : tickAt;
  const seconds = (at - startedAt.getTime()) / SECOND_MS;

  return (
    // `accessible` collapses the numerals into one spoken item. Without it a
    // screen reader reads the digits as they are drawn, and they change
    // under it every second.
    <View accessible accessibilityLabel={spokenElapsed(seconds)} testID="logger-elapsed">
      <Metric value={formatElapsed(seconds)} size="numeral" tone="glass" />
    </View>
  );
}
