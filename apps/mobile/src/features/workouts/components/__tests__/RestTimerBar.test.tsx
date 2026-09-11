import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';

import { useRestTimerStore } from '../../store/rest-timer-store.ts';
import {
  REST_TIMER_COPY,
  RestTimerBar,
  formatOvertime,
  speakRestOvertime,
  speakRestRemaining,
} from '../RestTimerBar.tsx';

// `rest-timer/05`. Three things this file exists to hold, because each is a
// way the bar is wrong in a way nothing on screen would show:
//
//   - the drawn number is the STORE's `remainingSeconds`, never a second
//     computation, so it cannot drift from task 03's lock-screen surface;
//   - Skip is `stopRest()` and lands in FULL idle, which is the one signal
//     tasks 03 and 04 read as "cancelled, do not alert";
//   - the spoken value is coarser than the drawn one and rounds DOWN, so a
//     screen reader is neither read a number every second nor offered time
//     the client does not have.

const T0 = 1_760_000_000_000;

function startRest(targetSeconds: number): void {
  act(() => {
    useRestTimerStore.getState().startRest(targetSeconds, { nowMs: T0 });
  });
}

function tickTo(offsetSeconds: number): void {
  act(() => {
    useRestTimerStore.getState().tick(T0 + offsetSeconds * 1000);
  });
}

describe('formatOvertime', () => {
  it('marks the value as time past the target rather than time remaining', () => {
    expect(formatOvertime(18)).toBe('+0:18');
  });

  it('reads as a clock once past a minute', () => {
    expect(formatOvertime(95)).toBe('+1:35');
  });
});

describe('speakRestRemaining', () => {
  it('counts every second in the last ten, where each one matters', () => {
    expect(speakRestRemaining(6)).toBe('Rest, 6 seconds left');
  });

  it('uses the singular at one second', () => {
    expect(speakRestRemaining(1)).toBe('Rest, 1 second left');
  });

  it('rounds down to ten-second steps under a minute, so it never over-promises', () => {
    expect(speakRestRemaining(44)).toBe('Rest, 40 seconds left');
  });

  it('rounds down to half-minutes above a minute and says so', () => {
    expect(speakRestRemaining(100)).toBe('Rest, about 1 minute 30 seconds left');
  });

  it('drops the seconds segment on a whole minute', () => {
    expect(speakRestRemaining(124)).toBe('Rest, about 2 minutes left');
  });
});

describe('speakRestOvertime', () => {
  it('states the fact and nothing about the client', () => {
    expect(speakRestOvertime(18)).toBe('Rest done, 18 seconds over');
  });

  it('has a zero form that is still not an instruction', () => {
    expect(speakRestOvertime(0)).toBe('Rest done');
  });
});

describe('RestTimerBar', () => {
  // Scoped here so it runs BEFORE `jest.setup.ts`'s root-level reset: that
  // reset returns the store to idle, and this component subscribes to it,
  // so a tree still mounted at that point takes a state update outside
  // `act()`. Unmounting first is the fix, not silencing the warning.
  afterEach(cleanup);

  it('is absent, not disabled, when no rest is running', () => {
    render(<RestTimerBar />);

    expect(screen.queryByTestId('rest-timer-bar')).toBeNull();
  });

  it('draws the store’s remaining seconds, and redraws them on the store’s tick', () => {
    render(<RestTimerBar />);
    startRest(90);

    expect(screen.getByTestId('rest-timer-value')).toHaveTextContent('1:30');

    tickTo(6);

    expect(screen.getByTestId('rest-timer-value')).toHaveTextContent('1:24');
  });

  it('meters the remaining fraction, so the state reads without colour', () => {
    render(<RestTimerBar />);
    startRest(100);
    tickTo(25);

    expect(screen.getByTestId('rest-timer-meter-fill')).toHaveStyle({ flexGrow: 0.75 });
  });

  it('announces the state in words rather than the punctuation of a clock', () => {
    render(<RestTimerBar />);
    startRest(90);

    expect(screen.getByLabelText('Rest, about 1 minute 30 seconds left')).toBeTruthy();
  });

  it('offers a labelled way out while the rest runs', () => {
    render(<RestTimerBar />);
    startRest(90);

    expect(screen.getByLabelText(REST_TIMER_COPY.skipAction)).toBeTruthy();
  });

  it('puts the store in FULL idle when skipped — the signal tasks 03 and 04 read as cancelled', () => {
    render(<RestTimerBar />);
    startRest(90);

    fireEvent.press(screen.getByLabelText(REST_TIMER_COPY.skipAction));

    const state = useRestTimerStore.getState();
    expect(state.isRunning).toBe(false);
    // Both of these, not just `isRunning`: a completed rest also has
    // `isRunning: false` and KEEPS its anchor, and that is what task 04
    // alerts on. A skip must be distinguishable from it.
    expect(state.startedAtMs).toBeNull();
    expect(state.targetSeconds).toBe(0);
    expect(screen.queryByTestId('rest-timer-bar')).toBeNull();
  });

  it('stays past zero and counts up, without reddening or instructing', () => {
    // The store's own zero: `isRunning` false, anchor and target kept.
    render(<RestTimerBar now={new Date(T0 + 108_000)} />);
    startRest(90);
    tickTo(108);

    expect(screen.getByTestId('rest-timer-label')).toHaveTextContent(REST_TIMER_COPY.done);
    expect(screen.getByTestId('rest-timer-value')).toHaveTextContent('+0:18');
    expect(screen.getByLabelText('Rest done, 18 seconds over')).toBeTruthy();
  });

  it('empties the meter past zero rather than filling it', () => {
    render(<RestTimerBar now={new Date(T0 + 108_000)} />);
    startRest(90);
    tickTo(108);

    expect(screen.getByTestId('rest-timer-meter-fill')).toHaveStyle({ flexGrow: 0 });
  });

  it('dismisses through the same single cancellation path', () => {
    render(<RestTimerBar now={new Date(T0 + 108_000)} />);
    startRest(90);
    tickTo(108);

    fireEvent.press(screen.getByLabelText(REST_TIMER_COPY.dismissAction));

    expect(useRestTimerStore.getState().startedAtMs).toBeNull();
    expect(screen.queryByTestId('rest-timer-bar')).toBeNull();
  });

  it('is absent for a zero-second target, which the store never runs', () => {
    render(<RestTimerBar />);
    // `resolveRestSeconds` decision (d): a coach may prescribe no rest, and
    // the store goes straight to idle rather than running a 0.
    startRest(0);

    expect(screen.queryByTestId('rest-timer-bar')).toBeNull();
  });
});
