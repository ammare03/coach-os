import { act, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import type { PRCelebrationView } from '../../lib/pr-celebration.ts';
import {
  resetPRCelebrationForTests,
  usePRCelebrationStore,
} from '../../store/pr-celebration-store.ts';
import { PRCelebration } from '../PRCelebration.tsx';

// `personal-records/03`. §8.4's requirement is "exactly once, **non-blocking**"
// and the second half is a layout property, not a feeling: the pill must cost
// the composer card zero height and must take no pointer events, or the
// confirm control moves and the client's thumb lands on nothing.

function view(overrides: Partial<PRCelebrationView> = {}): PRCelebrationView {
  return {
    token: 1,
    setLocalId: 'set-1',
    exerciseId: 'exercise-1',
    title: 'Personal record',
    detailLead: 'Bench press — heaviest ever,',
    detailValue: '92.5kg',
    moreCount: 0,
    label: 'Personal record. Bench press, heaviest ever, 92.5 kilograms.',
    types: ['max_weight'],
    ...overrides,
  };
}

function present(next: PRCelebrationView) {
  act(() => {
    usePRCelebrationStore.setState({ current: next });
  });
}

/** A style prop is an object, an array, or nested arrays — normalise before asserting. */
function flatStyle(node: { props: { style?: unknown } }): Record<string, unknown> {
  return Object.assign({}, ...[node.props.style].flat(3).filter(Boolean)) as Record<
    string,
    unknown
  >;
}

beforeEach(() => {
  resetPRCelebrationForTests();
  jest.restoreAllMocks();
});

describe('PRCelebration', () => {
  it('renders nothing when no record is on screen, which is almost always', () => {
    render(<PRCelebration />);

    expect(screen.queryByTestId('pr-celebration')).toBeNull();
  });

  it('says "Personal record" and the fact, with the exercise named', () => {
    render(<PRCelebration />);

    present(view());

    expect(screen.getByText('Personal record')).toBeTruthy();
    expect(screen.getByText('Bench press — heaviest ever,')).toBeTruthy();
    expect(screen.getByText('92.5kg')).toBeTruthy();
  });

  it('costs the composer card no layout height and takes no pointer events', () => {
    // The whole of "non-blocking", checkable rather than aspirational. The
    // pill is an absolutely positioned child at the card's top edge, so the
    // 205px card and its confirm control cannot move (`set-entry/03`).
    render(<PRCelebration />);
    present(view());

    const pill = screen.getByTestId('pr-celebration');
    const style = flatStyle(pill);

    expect(style.position).toBe('absolute');
    expect(style.bottom).toBe('100%');
    expect(pill.props.pointerEvents).toBe('none');
  });

  it('drops the glow under Reduce Transparency, and keeps the surface', async () => {
    // The glow is the one transparency effect here. Nothing is communicated
    // by it alone — the border and the gradient carry the surface — and the
    // setting is live, so this must not need a relaunch (`accessibility` §5).
    jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockResolvedValue(true);
    render(<PRCelebration />);
    present(view());

    await waitFor(() => {
      expect(flatStyle(screen.getByTestId('pr-celebration')).shadowOpacity).toBeUndefined();
    });
    expect(flatStyle(screen.getByTestId('pr-celebration')).borderColor).toBeDefined();
  });

  it('glows when transparency is allowed', () => {
    render(<PRCelebration />);
    present(view());

    expect(flatStyle(screen.getByTestId('pr-celebration')).shadowOpacity).toBe(0.4);
  });

  it('offers nothing to tap — there is no dismiss control', () => {
    render(<PRCelebration />);
    present(view());

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('pr-celebration').props.accessibilityRole).toBeUndefined();
  });

  it('is one polite utterance, never an interruption', () => {
    render(<PRCelebration />);
    present(view());

    const pill = screen.getByTestId('pr-celebration');
    expect(pill.props.accessibilityLiveRegion).toBe('polite');
    expect(pill.props.accessibilityLabel).toBe(
      'Personal record. Bench press, heaviest ever, 92.5 kilograms.',
    );
  });

  it('counts the other types beaten rather than showing a second pill', () => {
    render(<PRCelebration />);

    present(view({ moreCount: 2 }));

    // Hidden from the reading order on purpose — `view.label` is the one
    // utterance, and "+2" spoken alone says nothing.
    expect(screen.getByText('+2', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getAllByText('Personal record')).toHaveLength(1);
  });

  it('shows no count badge for a set that beat exactly one record', () => {
    render(<PRCelebration />);

    present(view());

    expect(screen.queryByText('+0', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByText('+1', { includeHiddenElements: true })).toBeNull();
  });

  describe('the dwell', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('leaves on its own, with no tap', () => {
      render(<PRCelebration />);
      present(view());

      act(() => {
        jest.advanceTimersByTime(2600 + 180);
      });

      expect(usePRCelebrationStore.getState().current).toBeNull();
      expect(screen.queryByTestId('pr-celebration')).toBeNull();
    });

    it('is still there through the whole 2.6 seconds', () => {
      render(<PRCelebration />);
      present(view());

      act(() => {
        jest.advanceTimersByTime(2599);
      });

      expect(screen.getByTestId('pr-celebration')).toBeTruthy();
    });

    it('clears its timer on unmount', () => {
      const tree = render(<PRCelebration />);
      present(view());
      tree.unmount();

      act(() => {
        jest.advanceTimersByTime(10_000);
      });

      // The store still holds it — nothing dismissed it — which is the
      // point: a timer that outlived its component must not reach back in.
      expect(usePRCelebrationStore.getState().current).not.toBeNull();
    });

    it('restarts the clock when a second record replaces the first', () => {
      render(<PRCelebration />);
      present(view());

      act(() => {
        jest.advanceTimersByTime(2000);
      });
      present(view({ token: 2, setLocalId: 'set-2' }));
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      // The first pill's 2.6s has long elapsed; the second's has not.
      expect(usePRCelebrationStore.getState().current?.token).toBe(2);

      act(() => {
        jest.advanceTimersByTime(1600 + 180);
      });
      expect(usePRCelebrationStore.getState().current).toBeNull();
    });
  });
});
