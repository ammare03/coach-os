import { hapticRestComplete } from '@coachos/ui';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';
import { AccessibilityInfo } from 'react-native';

import { useRestTimerStore, type RestTimerState } from '../store/rest-timer-store.ts';

import type { RestRestoration } from './rest-timer-persistence.ts';

// `phase-09-workout-logger/rest-timer/04` — what the client is told when a
// rest reaches zero, and `CLAUDE.md` §25.7's pitfall in the one place it
// can be fixed.
//
// §8.4 asks for a haptic and a sound at zero. The reason it is a whole task
// is that the moment it matters is precisely the moment nobody is looking:
// the phone is on a bench or in a pocket, face down, screen off. An alert
// that works in every developer test — phone in hand, app in front — and
// silently does nothing on a locked device is the failure this file exists
// to prevent, and the one §25.7 records from prior experience.
//
// Six decisions, in the order they matter:
//
// (a) **One alert, three channels, one turn.** The haptic, the tone, and
//     the screen-reader announcement all fire from {@link fireAlert},
//     synchronously, off one store transition. Not three subscribers: two
//     senses arriving a frame apart read as two events rather than one
//     (`apple-design` §13's harmony rule), and three subscribers would be
//     three opinions about whether a rest ended. Three channels because
//     each one is somebody's only channel — haptics off leaves the tone,
//     the ringer switch leaves the haptic, and VoiceOver leaves neither, so
//     the announcement is what a blind client gets instead of a countdown
//     they cannot see (`accessibility` §2, §8). A client with all three off
//     has the in-app countdown (`rest-timer/05`), which is the fourth and
//     is not this file's.
//
// (b) **Completion and cancellation are different transitions, and only one
//     of them alerts.** A rest that runs out leaves `isRunning: false` with
//     `startedAtMs` and `targetSeconds` intact (the store's `tick`); a rest
//     that is skipped or whose session finished goes fully idle via
//     `stopRest`, which nulls `startedAtMs`. So the predicate is "stopped
//     running, still knows when it began" and nothing else. A client who
//     skips their own rest and is then buzzed by it has been told the app
//     does not listen, which is how an app gets muted.
//
// (c) **A zero is only worth an alert while it is still news** —
//     {@link REST_ALERT_MAX_AGE_MS}. Three different things can land the
//     zero: the 1Hz interval, which sees it immediately; the foreground
//     listener (store decision (g)), which ticks against a clock the
//     interval never saw and can land a zero minutes old; and a cold-start
//     restore of a rest that ran out while the process was dead
//     (`rest-timer-persistence.ts` decision (e)). Only the first is
//     inherently recent. Without an age gate, unlocking a phone twenty
//     minutes after a rest ended buzzes and beeps for something the client
//     finished three sets ago — an interruption with no cause, which is
//     exactly the feedback `apple-design` §13's utility rule says trains
//     people to ignore all of it. So the gate is on the zero's own age, not
//     on which producer found it: one rule, three producers.
//
// (d) **Ten seconds, and short on purpose.** It covers the case that is
//     genuinely worth waking someone for — the process died and came back
//     around the instant the rest ended, the client is reaching for the
//     phone right now — and nothing beyond it. A client who returns later
//     is by definition looking at the screen, where the state is already
//     shown. The floor on the number is our own latency: a cold start has
//     to open the database and validate the session before it can report an
//     expiry, so a window of one or two seconds would be swallowed by the
//     restore itself.
//
// (e) **§25.7 has a native half and a JavaScript half, and neither works
//     alone.** `app.config.ts` carries `UIBackgroundModes: ['audio']` plus
//     the `expo-audio` plugin, which is what permits sound from a locked
//     device at all; {@link primeRestCompletionAlert} sets
//     `playsInSilentMode` and `shouldPlayInBackground`, without which the
//     session category still stops at the lock screen and at the ringer
//     switch. **Neither half makes a suspended process run.** When iOS has
//     evicted or suspended the app there is no JavaScript to reach this
//     file, and the alert for that case is a scheduled notification, which
//     is `rest-timer/03`'s. This file is what fires when the app is alive
//     at zero — foreground, or backgrounded and not yet suspended — and
//     what fires on the way back in, within (c)'s window.
//
// (f) **The interval stays armed while the app is backgrounded**, which is
//     the open question the store left for this task (decision (g) there).
//     Taking it away would be the wrong trade in both directions: the
//     interval is what detects zero, so disarming it means a rest that ends
//     while the app is alive-but-backgrounded — the common Android case,
//     and the first seconds of every iOS lock — alerts late or not at all,
//     and it saves nothing, because a 1Hz timer that recomputes one
//     subtraction is already below anything §19's battery budget can
//     measure and the OS throttles or suspends it for free. The store's
//     countdown is derived from the clock rather than accumulated
//     (decision (b) there), so a throttled interval is self-correcting on
//     its next fire and a suspended one costs nothing but time. There is
//     no code here for this decision, deliberately — it is a decision not
//     to add any.

/**
 * The tone. Two short sine bursts, A5 (880 Hz) then E6 (1318.51 Hz), 520ms
 * in total, 8ms attack and 12ms release on each so neither edge clicks —
 * synthesised for this repository rather than sourced, so there is no
 * licence attached to it and nothing to re-clear before a store build
 * (`CLAUDE.md` §3.4: free over paid, always). Mid-high because a phone
 * speaker has almost nothing below ~700 Hz and a gym has everything else,
 * and rising because it is a cue to start the next set rather than an alarm.
 *
 * A Metro asset id, not a path. `require` rather than `import` because the
 * typed form needs an ambient `declare module '*.wav'`, and a repo-global
 * declaration for one file is the larger change — and the one likelier to
 * collide with the next task that ships a sound.
 *
 * Annotated rather than `require<number>(…)`: that generic form resolves
 * only against a `require` declaration carrying a type parameter, which is
 * not what a clean install of this workspace provides — it typechecks on a
 * warm tree and fails on CI.
 */
const REST_COMPLETE_TONE: number = require('../../../../assets/audio/rest-complete.wav');

/**
 * How old a zero may be and still be worth interrupting someone for —
 * decisions (c) and (d).
 */
export const REST_ALERT_MAX_AGE_MS = 10_000;

const SECOND_MS = 1_000;

/**
 * What a screen reader says at zero. Sentence case, no exclamation mark, and
 * a fact rather than an instruction (`COPY.md` §CO6) — the client decides
 * when they lift, not the app.
 */
const REST_COMPLETE_ANNOUNCEMENT = 'Rest complete.';

let player: AudioPlayer | null = null;
let primed = false;

/**
 * Configures the audio session and builds the one player the app has.
 *
 * Called at startup by {@link ensureRestCompletionAlert} rather than lazily
 * at zero: loading an asset and negotiating an audio category takes long
 * enough to break decision (a)'s single turn, and the first rest of a
 * session is exactly the one a client is most likely to be watching.
 * Idempotent, and safe to call again — {@link playRestCompleteSound} does
 * when nothing primed it first.
 *
 * **The audio session is one global object and this file is its only
 * owner.** `setAudioModeAsync` is app-wide, not per-player, so a second
 * caller anywhere — a form-check video, a voice note — would silently
 * redefine whether the rest tone survives the lock screen, and the symptom
 * would appear in the logger rather than wherever the second call lives. A
 * later feature that needs a different session belongs here, deciding the
 * one mode both can live with, exactly as `CLAUDE.md` §3.1's `expo-audio`
 * row states.
 */
export function primeRestCompletionAlert(): void {
  if (primed) return;
  primed = true;

  // Decision (e)'s JavaScript half. `playsInSilentMode` because a gym phone
  // lives on the ringer switch; `shouldPlayInBackground` because the whole
  // point is a rest that ends after the client has locked the screen;
  // `duckOthers` because a cue mixed under the client's own music at gym
  // volume is a cue they do not hear, and a half-second dip is both audible
  // and self-explanatory. `allowsRecording: false` is stated rather than
  // left to default — the session must never become `.playAndRecord`, which
  // would route this through the earpiece and put a microphone indicator on
  // a screen the client never asked to record from.
  void setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'duckOthers',
    allowsRecording: false,
  }).catch((error: unknown) => {
    warn('workouts.rest_alert_audio_mode_failed', error);
  });

  try {
    // `keepAudioSessionActive` so finishing a half-second cue does not
    // deactivate the session under whatever else the client is playing.
    player = createAudioPlayer(REST_COMPLETE_TONE, { keepAudioSessionActive: true });
  } catch (error: unknown) {
    warn('workouts.rest_alert_player_failed', error);
  }
}

/**
 * Plays the completion tone. Fire-and-forget, and never throws — the same
 * contract `packages/ui/src/haptics/index.ts` holds itself to, for the same
 * reason: this accompanies something that already happened, so no caller may
 * await it or branch on whether it worked.
 */
export function playRestCompleteSound(): void {
  primeRestCompletionAlert();
  const current = player;
  if (current === null) return;

  try {
    // A finished player sits at the end of the clip, so a second rest would
    // be silent without the rewind. Both calls are dispatched in this turn
    // and the native side serialises them; the promise is awaited by nobody
    // because waiting would put the tone a frame behind the haptic.
    void current.seekTo(0).catch(() => undefined);
    current.play();
  } catch (error: unknown) {
    warn('workouts.rest_alert_play_failed', error);
  }
}

/** The zero's identity — decision (a)'s "fires once" made concrete. */
let lastAlertedKey: string | null = null;

function alertKey(sessionLocalId: string | null, endedAtMs: number): string {
  return `${sessionLocalId ?? ''}:${endedAtMs}`;
}

/**
 * The alert itself — decision (a). Age-gated by (c) and deduplicated by
 * `key`, so the two producers below can both be wired without either
 * having to know about the other.
 */
function fireAlert(key: string, endedAtMs: number): void {
  if (key === lastAlertedKey) return;
  // Negative age is a device whose clock moved between the two readings.
  // It is a zero we have only just seen, so it is news.
  if (Date.now() - endedAtMs > REST_ALERT_MAX_AGE_MS) return;

  lastAlertedKey = key;

  // Haptic first: it is the cheapest of the three and the one most likely
  // to be the only one that lands. Each is independently fire-and-forget,
  // so one failing never costs the others.
  hapticRestComplete();
  playRestCompleteSound();
  AccessibilityInfo.announceForAccessibility(REST_COMPLETE_ANNOUNCEMENT);
}

/**
 * A rest that ran out, as opposed to one that was skipped — decision (b).
 *
 * `startedAtMs` surviving is the store's own marker for "this rest ended on
 * its own": `tick` keeps it, `stopRest` nulls it.
 */
function endedNaturally(state: RestTimerState): boolean {
  return !state.isRunning && state.startedAtMs !== null && state.targetSeconds > 0;
}

let unsubscribe: (() => void) | null = null;

/**
 * Registers the one store subscription the alert has, and never a second one
 * however many times it is called — the module-scope-and-idempotent shape
 * `ensureRestTimerForegroundSync` and `ensureConnectivityTracking` use. A
 * second subscription would alert twice for one rest.
 *
 * Call it once at startup, **before** `ensureRestTimerPersistence()`, so a
 * rest that expired while the process was dead is caught by the restore's
 * own `resumeRest`. {@link alertForRestoredRest} covers the case where it is
 * not, and the two cannot double-fire.
 */
export function ensureRestCompletionAlert(): void {
  if (unsubscribe) return;
  primeRestCompletionAlert();

  let wasRunning = useRestTimerStore.getState().isRunning;
  unsubscribe = useRestTimerStore.subscribe((state) => {
    const isRunning = state.isRunning;
    const justEnded = wasRunning && endedNaturally(state);
    wasRunning = isRunning;
    if (!justEnded || state.startedAtMs === null) return;

    const endedAtMs = state.startedAtMs + state.targetSeconds * SECOND_MS;
    fireAlert(alertKey(state.sessionLocalId, endedAtMs), endedAtMs);
  });
}

/**
 * The rest a cold start found already over — `rest-timer-persistence.ts`'s
 * `{ kind: 'expired' }`, which carries the instant it actually reached zero
 * rather than the instant we noticed.
 *
 * Deliberately not a second rule: it runs the same age gate and shares the
 * same dedupe key as the subscription above, so whichever of the two sees a
 * given zero first, it alerts exactly once. The other two restorations are
 * accepted and ignored, so the caller never has to switch on `kind`.
 *
 * `unknown` rather than {@link RestRestoration} because the one call site —
 * `components/SessionRecoveryRedirect.tsx` — holds the restore behind a
 * `Promise<unknown>` seam it injects in tests. The guard below is therefore
 * a real boundary check, not ceremony.
 */
export function alertForRestoredRest(restoration: unknown): void {
  if (!isExpiredRestoration(restoration)) return;
  fireAlert(alertKey(restoration.sessionLocalId, restoration.endedAtMs), restoration.endedAtMs);
}

type ExpiredRest = Extract<RestRestoration, { kind: 'expired' }>;

/**
 * Never a partially rebuilt expiry — the same rule `parseRestAnchor` holds
 * for the row this ultimately came from. A `NaN` instant would pass the age
 * gate's comparison as `false` and alert, which is the one way a malformed
 * value could reach a client's pocket.
 */
function isExpiredRestoration(value: unknown): value is ExpiredRest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['kind'] !== 'expired') return false;
  if (typeof candidate['sessionLocalId'] !== 'string') return false;
  return typeof candidate['endedAtMs'] === 'number' && Number.isFinite(candidate['endedAtMs']);
}

/**
 * A code and the shape of the failure, never the message and never anything
 * about the session (`observability-ops` §1). Not reported to Sentry: a cue
 * that did not play costs one prompt the client will get from the screen
 * instead, and it is not a crash (`code-conventions` §8).
 */
function warn(code: string, error: unknown): void {
  console.warn(code, { errorName: error instanceof Error ? error.name : 'unknown' });
}

/** Test-only teardown — drops the subscription, the player, and the last zero. */
export function resetRestCompletionAlertForTests(): void {
  unsubscribe?.();
  unsubscribe = null;
  player = null;
  primed = false;
  lastAlertedKey = null;
}
