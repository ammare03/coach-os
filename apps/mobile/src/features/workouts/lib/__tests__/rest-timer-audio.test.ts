import * as Haptics from 'expo-haptics';
import { AccessibilityInfo } from 'react-native';

import { resetRestTimerForTests, useRestTimerStore } from '../../store/rest-timer-store.ts';
import {
  REST_ALERT_MAX_AGE_MS,
  alertForRestoredRest,
  ensureRestCompletionAlert,
  playRestCompleteSound,
  primeRestCompletionAlert,
  resetRestCompletionAlertForTests,
} from '../rest-timer-audio.ts';

// The bundled tone is a Metro asset id, and Jest has no transformer for an
// audio file (`@react-native/jest-preset` lists images and mp4 only). A
// factory mock means the real `.wav` is never read; the id it stands in for
// is asserted below exactly as the app would pass it.
jest.mock('../../../../../assets/audio/rest-complete.wav', () => 4242);

const mockPlay = jest.fn();
const mockSeekTo = jest.fn((_seconds: number): Promise<void> => Promise.resolve());
const mockCreateAudioPlayer = jest.fn((_source: unknown, _options?: unknown) => ({
  play: mockPlay,
  seekTo: mockSeekTo,
}));
const mockSetAudioModeAsync = jest.fn((_mode: unknown): Promise<void> => Promise.resolve());

jest.mock('expo-audio', () => ({
  createAudioPlayer: (source: unknown, options?: unknown) => mockCreateAudioPlayer(source, options),
  setAudioModeAsync: (mode: unknown) => mockSetAudioModeAsync(mode),
}));

// The real `@coachos/ui` haptic runs, so what is asserted below is the
// waveform that actually reaches the device rather than a stand-in for it.
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

const SESSION = 'session-local-1';
const NOW = 1_757_000_000_000;

let clockMs = NOW;

function setNow(ms: number): void {
  clockMs = ms;
}

/**
 * A rest that ran its full course and reached zero at `endedAtMs`, observed
 * — ticked — at `observedAtMs`. The two differ exactly when the app was not
 * awake at zero and only noticed later.
 */
function runRestToZero(options: {
  endedAtMs: number;
  targetSeconds?: number;
  observedAtMs?: number;
}): void {
  const targetSeconds = options.targetSeconds ?? 90;
  const observedAtMs = options.observedAtMs ?? options.endedAtMs;
  setNow(observedAtMs);

  const store = useRestTimerStore.getState();
  store.startRest(targetSeconds, {
    sessionLocalId: SESSION,
    nowMs: options.endedAtMs - targetSeconds * 1_000,
  });
  store.tick(observedAtMs);
}

beforeEach(() => {
  setNow(NOW);
  jest.spyOn(Date, 'now').mockImplementation(() => clockMs);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);

  mockPlay.mockClear();
  mockPlay.mockImplementation(() => undefined);
  mockSeekTo.mockClear();
  mockSeekTo.mockImplementation(() => Promise.resolve());
  mockCreateAudioPlayer.mockClear();
  mockCreateAudioPlayer.mockImplementation(() => ({ play: mockPlay, seekTo: mockSeekTo }));
  mockSetAudioModeAsync.mockClear();
  mockSetAudioModeAsync.mockImplementation(() => Promise.resolve());
});

afterEach(() => {
  resetRestCompletionAlertForTests();
  resetRestTimerForTests();
});

describe('the audio session', () => {
  it('asks for playback in silent mode and while backgrounded', () => {
    // `CLAUDE.md` §25.7's JavaScript half. The Info.plist background mode
    // alone does nothing if the session category still stops at the lock
    // screen, and a phone on the ringer switch is the normal state of a
    // phone in a gym.
    primeRestCompletionAlert();

    expect(mockSetAudioModeAsync).toHaveBeenCalledTimes(1);
    expect(mockSetAudioModeAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        allowsRecording: false,
      }),
    );
  });

  it('ducks other audio rather than mixing with it', () => {
    // A cue mixed under the client's own music at gym volume is a cue they
    // do not hear. Ducking dips the other app for the length of the tone,
    // which is both audible and self-explanatory.
    primeRestCompletionAlert();

    expect(mockSetAudioModeAsync).toHaveBeenCalledWith(
      expect.objectContaining({ interruptionMode: 'duckOthers' }),
    );
  });

  it('builds one player for the whole app, from the bundled tone', () => {
    primeRestCompletionAlert();
    primeRestCompletionAlert();
    playRestCompleteSound();

    expect(mockCreateAudioPlayer).toHaveBeenCalledTimes(1);
    expect(mockCreateAudioPlayer).toHaveBeenCalledWith(4242, expect.anything());
    expect(mockSetAudioModeAsync).toHaveBeenCalledTimes(1);
  });

  it('rewinds before every play, so a second rest is not silent', () => {
    playRestCompleteSound();
    playRestCompleteSound();

    expect(mockPlay).toHaveBeenCalledTimes(2);
    expect(mockSeekTo).toHaveBeenNthCalledWith(1, 0);
    expect(mockSeekTo).toHaveBeenNthCalledWith(2, 0);
  });

  it('primes itself when nothing primed it first', () => {
    playRestCompleteSound();

    expect(mockCreateAudioPlayer).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });

  it('swallows a player that will not start', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockPlay.mockImplementation(() => {
      throw new Error('AVAudioSession unavailable');
    });

    expect(() => {
      playRestCompleteSound();
    }).not.toThrow();
    // A code and the failure's shape, never the message — `observability-ops` §1.
    expect(warn).toHaveBeenCalledWith('workouts.rest_alert_play_failed', {
      errorName: 'Error',
    });
  });
});

describe('a rest that reaches zero', () => {
  beforeEach(() => {
    ensureRestCompletionAlert();
  });

  it('fires the haptic and the sound together', () => {
    runRestToZero({ endedAtMs: NOW });

    // Synchronously, in the same turn as the zero — nothing between them
    // may await. Two senses arriving a frame apart read as two events.
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith('heavy');
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });

  it('announces itself to a screen reader', () => {
    // A client with VoiceOver on has no countdown to glance at, and the
    // other two channels are both silent on a phone that is muted with
    // haptics turned off.
    runRestToZero({ endedAtMs: NOW });

    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
  });

  it('fires once, however many times the store re-emits', () => {
    runRestToZero({ endedAtMs: NOW });
    useRestTimerStore.getState().tick(NOW + 5_000);
    useRestTimerStore.setState({ remainingSeconds: 0 });

    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });

  it('fires again for the next rest', () => {
    runRestToZero({ endedAtMs: NOW });
    runRestToZero({ endedAtMs: NOW + 200_000 });

    expect(Haptics.impactAsync).toHaveBeenCalledTimes(2);
    expect(mockPlay).toHaveBeenCalledTimes(2);
  });

  it('still fires the haptic when the sound throws', () => {
    // A device whose audio session something else has grabbed, or a player
    // that failed to load. One channel failing must not take the other with
    // it, and neither may reach the caller.
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockPlay.mockImplementation(() => {
      throw new Error('AVAudioSession unavailable');
    });

    expect(() => {
      runRestToZero({ endedAtMs: NOW });
    }).not.toThrow();
    expect(Haptics.impactAsync).toHaveBeenCalledWith('heavy');
  });
});

describe('a rest that did not reach zero', () => {
  beforeEach(() => {
    ensureRestCompletionAlert();
  });

  it('stays silent when the client skips it', () => {
    // `stopRest()` is the skip control's call. Buzzing someone for a rest
    // they just cancelled is the fastest way to get the app muted.
    useRestTimerStore.getState().startRest(90, { sessionLocalId: SESSION, nowMs: NOW - 10_000 });
    useRestTimerStore.getState().stopRest();

    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it('stays silent when the session is finished under it', () => {
    useRestTimerStore.getState().startRest(90, { sessionLocalId: SESSION, nowMs: NOW - 10_000 });
    useRestTimerStore.getState().stopRestForSession(SESSION);

    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it('stays silent for an exercise that prescribes no rest at all', () => {
    // `target_rest_seconds = 0` is a real prescription (store decision (d)).
    // There is no rest to end, so there is nothing to announce.
    useRestTimerStore.getState().startRest(0, { sessionLocalId: SESSION, nowMs: NOW });

    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(mockPlay).not.toHaveBeenCalled();
  });
});

describe('a zero nobody was awake for', () => {
  beforeEach(() => {
    ensureRestCompletionAlert();
  });

  it('fires when the app noticed within the window', () => {
    runRestToZero({ endedAtMs: NOW, observedAtMs: NOW + REST_ALERT_MAX_AGE_MS - 1_000 });

    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  });

  it('stays silent for a rest that ended long before the app woke up', () => {
    // The foreground listener (store decision (g)) ticks against a clock
    // the interval never saw, so the zero it lands on can be minutes old.
    // Alerting then interrupts a client for something they already
    // finished, and the on-screen state says it better.
    runRestToZero({ endedAtMs: NOW, observedAtMs: NOW + REST_ALERT_MAX_AGE_MS + 1_000 });

    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(mockPlay).not.toHaveBeenCalled();
  });
});

describe('a rest restored from a dead process', () => {
  it('alerts for an expiry that just happened', () => {
    alertForRestoredRest({
      kind: 'expired',
      sessionLocalId: SESSION,
      targetSeconds: 90,
      endedAtMs: NOW - 2_000,
    });

    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });

  it('stays silent for an expiry the client has long since moved past', () => {
    alertForRestoredRest({
      kind: 'expired',
      sessionLocalId: SESSION,
      targetSeconds: 90,
      endedAtMs: NOW - REST_ALERT_MAX_AGE_MS - 1,
    });

    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it('never alerts for a rest that is still running, or for no rest at all', () => {
    alertForRestoredRest({ kind: 'resumed', sessionLocalId: SESSION, remainingSeconds: 40 });
    alertForRestoredRest({ kind: 'none' });

    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it('ignores a restoration shape it does not recognise', () => {
    // The one call site hands this across a `Promise<unknown>`, so the
    // narrowing is real rather than ceremonial — a half-built expiry must
    // not become a haptic at `NaN` milliseconds ago.
    alertForRestoredRest(undefined);
    alertForRestoredRest({ kind: 'expired' });
    alertForRestoredRest({ kind: 'expired', sessionLocalId: SESSION, endedAtMs: 'soon' });
    alertForRestoredRest({ kind: 'expired', sessionLocalId: SESSION, endedAtMs: Number.NaN });

    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it('does not alert twice when the subscription already caught the same zero', () => {
    ensureRestCompletionAlert();

    runRestToZero({ endedAtMs: NOW - 1_000 });
    alertForRestoredRest({
      kind: 'expired',
      sessionLocalId: SESSION,
      targetSeconds: 90,
      endedAtMs: NOW - 1_000,
    });

    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  });
});

describe('registration', () => {
  it('registers one subscription however many times it is called', () => {
    ensureRestCompletionAlert();
    ensureRestCompletionAlert();
    ensureRestCompletionAlert();

    runRestToZero({ endedAtMs: NOW });

    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });

  it('alerts for nothing until it is registered', () => {
    runRestToZero({ endedAtMs: NOW });

    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });
});
