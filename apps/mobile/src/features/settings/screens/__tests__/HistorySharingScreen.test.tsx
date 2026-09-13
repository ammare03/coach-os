import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { SHARING_COPY } from '../../../onboarding/components/SharingControls.tsx';
import {
  HISTORY_SHARING_COPY,
  HistorySharingScreen,
  isNarrowingDecision,
  type HistorySharingDecision,
  type HistorySharingScreenProps,
  type SharingCoach,
} from '../HistorySharingScreen.tsx';

// jest-expo's `Dimensions` fixture reports `fontScale: 2`, which is not a
// neutral default here: past 1.5 `SharingControls` swaps its segmented
// track for three radio rows. Pinned to 1 so these cases exercise the
// ordinary shape; the 200% shape is
// `features/onboarding/components/__tests__/SharingControls.test.tsx`'s.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));

const mockSetOptions = jest.fn();

// The native header's title is the only chrome this screen sets, and it is
// data-derived — so it goes through `Stack.Screen`, and the test reads what
// was handed to it rather than a rendered string.
jest.mock('expo-router', () => ({
  Stack: { Screen: (props: { options?: { title?: string } }) => mockSetOptions(props.options) },
  useRouter: () => ({ back: mockBack }),
}));

const mockBack = jest.fn();

jest.mock('../../../../lib/time-zone/useClientTimeZone.ts', () => ({
  useClientTimeZone: () => 'Asia/Kolkata',
}));

function coach(overrides: Partial<SharingCoach> = {}): SharingCoach {
  return {
    id: '018f4b1e-0000-7000-8000-0000000000c1',
    name: 'Marcus Bell',
    businessName: null,
    historySharingChoice: 'twelve_weeks',
    historySharedFrom: new Date('2026-06-20T04:00:00.000Z'),
    metricsSharedFrom: new Date('2026-06-20T04:00:00.000Z'),
    nutritionSharedFrom: null,
    ...overrides,
  };
}

function props(overrides: Partial<HistorySharingScreenProps> = {}): HistorySharingScreenProps {
  return {
    coach: coach(),
    isLoading: false,
    onChange: jest.fn(),
    didNarrow: false,
    onRetryWrite: jest.fn(),
    onRetryLoad: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  mockSetOptions.mockClear();
  mockBack.mockClear();
});

function lastTitle(): string | undefined {
  const call = mockSetOptions.mock.calls.at(-1);
  return (call?.[0] as { title?: string } | undefined)?.title;
}

describe('HistorySharingScreen — the current setting, read from the server', () => {
  // 03's acceptance criterion. The three stored values arrive on one query
  // with the coach's name, so nothing here is a default and nothing is a
  // half-rendered control.
  it('selects the option the client actually chose', () => {
    render(<HistorySharingScreen {...props()} />);

    expect(screen.getByLabelText('12 weeks, tab 2 of 3').props.accessibilityState.selected).toBe(
      true,
    );
  });

  it('derives each toggle from whether its timestamp is set at all', () => {
    render(<HistorySharingScreen {...props()} />);

    expect(screen.getByTestId('sharing-toggle-metrics').props.accessibilityState.checked).toBe(
      true,
    );
    expect(screen.getByTestId('sharing-toggle-nutrition').props.accessibilityState.checked).toBe(
      false,
    );
  });

  // A timestamp cannot be inverted back to the option that produced it, so
  // a client whose row predates `history_sharing_choice` has no derivable
  // choice. No segment may claim to be the chosen one.
  it('selects nothing when the stored choice is absent', () => {
    render(<HistorySharingScreen {...props({ coach: coach({ historySharingChoice: null }) })} />);

    expect(screen.getByLabelText('12 weeks, tab 2 of 3').props.accessibilityState.selected).toBe(
      false,
    );
  });

  it('reports the resolved window in words, dated in the client’s own zone', () => {
    render(<HistorySharingScreen {...props()} />);

    expect(screen.getByText('Marcus can see your training from 20 June.')).toBeTruthy();
  });

  it('states the everything and nothing windows without a date', () => {
    const { unmount } = render(
      <HistorySharingScreen {...props({ coach: coach({ historySharingChoice: 'everything' }) })} />,
    );
    expect(screen.getByText('Marcus can see all your training history.')).toBeTruthy();
    unmount();

    render(
      <HistorySharingScreen {...props({ coach: coach({ historySharingChoice: 'nothing' }) })} />,
    );
    expect(screen.getByText('Marcus can see your training from today on.')).toBeTruthy();
  });
});

describe('HistorySharingScreen — the title names a person, never a brand', () => {
  it('takes the coach’s first name only', () => {
    render(<HistorySharingScreen {...props()} />);

    expect(lastTitle()).toBe('What Marcus can see');
  });

  // A white-labelled gym brand in that sentence would name the wrong party:
  // this screen is about what a PERSON can see.
  it('never takes the business name', () => {
    render(
      <HistorySharingScreen {...props({ coach: coach({ businessName: 'Iron Vault Fitness' }) })} />,
    );

    expect(lastTitle()).toBe('What Marcus can see');
  });

  it('falls back rather than flashing a name it does not have', () => {
    render(<HistorySharingScreen {...props({ coach: undefined, isLoading: true })} />);

    expect(lastTitle()).toBe(HISTORY_SHARING_COPY.titleFallback);
  });
});

describe('HistorySharingScreen — widening is instant, narrowing is honest', () => {
  it('sends the whole decision on every write, not just the field that moved', () => {
    const onChange = jest.fn();
    render(<HistorySharingScreen {...props({ onChange })} />);

    fireEvent.press(screen.getByLabelText('Everything, tab 3 of 3'));

    expect(onChange).toHaveBeenCalledWith({
      historySharing: 'everything',
      shareMetrics: true,
      shareNutrition: false,
    });
  });

  it('says nothing extra when the client widens', () => {
    render(<HistorySharingScreen {...props()} />);

    expect(screen.queryByTestId('sharing-forward-only')).toBeNull();
  });

  // The rule `account-lifecycle/07` made and this task enforces, on the
  // RENDERED TEXT: narrowing applies going forward and does not claw back
  // what the coach has already read, and the screen must not pretend
  // otherwise. Driven through the real `isNarrowingDecision` rule so the
  // assertion is end to end rather than a prop set by hand.
  it('renders the forward-only note when a narrowing write lands', () => {
    render(<NarrowingHarness />);

    expect(screen.queryByTestId('sharing-forward-only')).toBeNull();

    fireEvent.press(screen.getByLabelText('Nothing, tab 1 of 3'));

    expect(
      screen.getByText('This applies from now on. It does not undo what Marcus has already seen.'),
    ).toBeTruthy();
  });

  it('shows it for a narrowed toggle too, and never takes it back', () => {
    render(<NarrowingHarness />);

    fireEvent.press(screen.getByTestId('sharing-toggle-metrics'));
    expect(screen.getByTestId('sharing-forward-only')).toBeTruthy();

    // Widening again does not un-say it: the coach has still seen what they
    // have seen.
    fireEvent.press(screen.getByLabelText('Everything, tab 3 of 3'));
    expect(screen.getByTestId('sharing-forward-only')).toBeTruthy();
  });

  it('announces the note politely rather than interrupting', () => {
    render(<HistorySharingScreen {...props({ didNarrow: true })} />);

    expect(screen.getByTestId('sharing-forward-only').props.accessibilityLiveRegion).toBe('polite');
  });
});

describe('isNarrowingDecision', () => {
  const wide: HistorySharingDecision = {
    historySharing: 'everything',
    shareMetrics: true,
    shareNutrition: true,
  };

  it('is false with nothing to compare against', () => {
    expect(isNarrowingDecision(null, wide)).toBe(false);
  });

  it('is true when the window shrinks', () => {
    expect(isNarrowingDecision(wide, { ...wide, historySharing: 'twelve_weeks' })).toBe(true);
    expect(
      isNarrowingDecision(
        { ...wide, historySharing: 'nothing' },
        { ...wide, historySharing: 'twelve_weeks' },
      ),
    ).toBe(false);
  });

  it('is true when either toggle is turned off', () => {
    expect(isNarrowingDecision(wide, { ...wide, shareMetrics: false })).toBe(true);
    expect(isNarrowingDecision(wide, { ...wide, shareNutrition: false })).toBe(true);
  });

  it('is false when everything widens at once', () => {
    const narrow: HistorySharingDecision = {
      historySharing: 'nothing',
      shareMetrics: false,
      shareNutrition: false,
    };
    expect(isNarrowingDecision(narrow, wide)).toBe(false);
  });
});

describe('HistorySharingScreen — the absence is the feature', () => {
  it('states what has no setting at all, in every state', () => {
    const { unmount } = render(<HistorySharingScreen {...props()} />);
    expect(screen.getByTestId('sharing-never-shared')).toBeTruthy();
    unmount();

    const loading = render(
      <HistorySharingScreen {...props({ coach: undefined, isLoading: true })} />,
    );
    expect(screen.getByTestId('sharing-never-shared')).toBeTruthy();
    loading.unmount();

    render(
      <HistorySharingScreen
        {...props({ coach: undefined, loadError: 'Network request failed' })}
      />,
    );
    expect(screen.getByTestId('sharing-never-shared')).toBeTruthy();
  });

  it('offers no control for messages, check-ins, or progress photos', () => {
    render(<HistorySharingScreen {...props()} />);

    expect(screen.getAllByRole('switch')).toHaveLength(2);
    expect(screen.getByText(SHARING_COPY.neverSharedBody)).toBeTruthy();
    expect(screen.queryByText(/messages.*toggle|share messages/i)).toBeNull();
  });
});

describe('HistorySharingScreen — the two failures that must not draw a control', () => {
  // A privacy screen that cannot read the current state must not draw a
  // control that looks like it knows one.
  it('draws no control when the read failed, and offers a way back', () => {
    const onRetryLoad = jest.fn();
    render(
      <HistorySharingScreen {...props({ coach: undefined, loadError: 'boom', onRetryLoad })} />,
    );

    expect(screen.queryByTestId('sharing-history-segmented')).toBeNull();
    expect(screen.getByText(HISTORY_SHARING_COPY.readFailedTitle)).toBeTruthy();
    expect(screen.getByText(HISTORY_SHARING_COPY.readFailedBody)).toBeTruthy();

    fireEvent.press(screen.getByText(HISTORY_SHARING_COPY.tryAgain));
    expect(onRetryLoad).toHaveBeenCalled();
  });

  it('draws no control while the one query is still in flight', () => {
    render(<HistorySharingScreen {...props({ coach: undefined, isLoading: true })} />);

    expect(screen.queryByTestId('sharing-history-segmented')).toBeNull();
    expect(screen.getByLabelText(HISTORY_SHARING_COPY.loadingLabel)).toBeTruthy();
  });

  it('explains a coachless client rather than offering them a control', () => {
    render(<HistorySharingScreen {...props({ coach: null })} />);

    expect(screen.queryByTestId('sharing-history-segmented')).toBeNull();
    expect(screen.getByText(HISTORY_SHARING_COPY.noCoachTitle)).toBeTruthy();

    fireEvent.press(screen.getByText(HISTORY_SHARING_COPY.noCoachAction));
    expect(mockBack).toHaveBeenCalled();
  });
});

describe('HistorySharingScreen — the write failed', () => {
  // The second sentence is the one that matters on a privacy surface: a
  // client who believes they narrowed something they did not is worse off
  // than one who saw an error.
  it('says nothing has changed, and offers the write again', () => {
    const onRetryWrite = jest.fn();
    render(<HistorySharingScreen {...props({ writeError: 'offline', onRetryWrite })} />);

    expect(
      screen.getByText('We couldn’t save that change. Nothing has changed for Marcus.'),
    ).toBeTruthy();
    expect(screen.getByTestId('sharing-write-error').props.accessibilityRole).toBe('alert');

    fireEvent.press(screen.getByText(HISTORY_SHARING_COPY.tryAgain));
    expect(onRetryWrite).toHaveBeenCalled();
  });

  it('keeps the control live so the client can choose again', () => {
    render(<HistorySharingScreen {...props({ writeError: 'offline' })} />);

    expect(screen.getByTestId('sharing-history-segmented')).toBeTruthy();
  });
});

/**
 * Holds the decision and derives `didNarrow` with the real rule, so the
 * forward-only assertions run against a press rather than a prop.
 */
function NarrowingHarness() {
  const [decision, setDecision] = useState<HistorySharingDecision>({
    historySharing: 'everything',
    shareMetrics: true,
    shareNutrition: true,
  });
  const [didNarrow, setDidNarrow] = useState(false);

  return (
    <HistorySharingScreen
      {...props({
        coach: coach({
          historySharingChoice: decision.historySharing,
          metricsSharedFrom: decision.shareMetrics ? new Date('2026-06-20T04:00:00.000Z') : null,
          nutritionSharedFrom: decision.shareNutrition
            ? new Date('2026-06-20T04:00:00.000Z')
            : null,
        }),
        didNarrow,
        onChange: (next) => {
          if (isNarrowingDecision(decision, next)) setDidNarrow(true);
          setDecision(next);
        },
      })}
    />
  );
}
