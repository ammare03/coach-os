import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  NeverSharedNote,
  SHARING_COPY,
  SharingControls,
  type SharingControlsProps,
} from '../SharingControls.tsx';

// The font scale the control branches on. Mocked at the module React
// Native's own `useWindowDimensions` re-exports, which is the only seam
// that does not require a device (`accessibility` §3 — 200% text is a test,
// not a hope).
let mockFontScale = 1;

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }),
}));

function props(overrides: Partial<SharingControlsProps> = {}): SharingControlsProps {
  return {
    coachFirstName: 'Marcus',
    historySharing: 'twelve_weeks',
    onHistorySharingChange: jest.fn(),
    shareMetrics: true,
    onShareMetricsChange: jest.fn(),
    shareNutrition: false,
    onShareNutritionChange: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  mockFontScale = 1;
});

describe('SharingControls — the one control both surfaces render', () => {
  it('offers the three shipped options, least to most', () => {
    render(<SharingControls {...props()} />);

    expect(screen.getByLabelText('Nothing, tab 1 of 3')).toBeTruthy();
    expect(screen.getByLabelText('12 weeks, tab 2 of 3')).toBeTruthy();
    expect(screen.getByLabelText('Everything, tab 3 of 3')).toBeTruthy();
  });

  it('reports the option that was pressed', () => {
    const onHistorySharingChange = jest.fn();
    render(<SharingControls {...props({ onHistorySharingChange })} />);

    fireEvent.press(screen.getByLabelText('Everything, tab 3 of 3'));

    expect(onHistorySharingChange).toHaveBeenCalledWith('everything');
  });

  // `SegmentedControl` takes `V | null` for exactly this: the settings
  // screen cannot always derive the stored choice, and a segment claiming
  // to be chosen when nothing is would be the control lying about consent.
  it('selects nothing when the current choice is unknown', () => {
    render(<SharingControls {...props({ historySharing: null })} />);

    for (const label of ['Nothing, tab 1 of 3', '12 weeks, tab 2 of 3', 'Everything, tab 3 of 3']) {
      expect(screen.getByLabelText(label).props.accessibilityState.selected).toBe(false);
    }
  });

  it('names the field as a header so a screen reader can jump to it', () => {
    render(<SharingControls {...props()} />);

    expect(screen.getByRole('header', { name: SHARING_COPY.fieldLabel })).toBeTruthy();
  });

  it('puts the coach first name in the helper line', () => {
    render(<SharingControls {...props({ coachFirstName: 'Priya' })} />);

    expect(screen.getByText('Workouts and logged sets from before you joined Priya.')).toBeTruthy();
  });
});

describe('SharingControls — the two toggles', () => {
  // `accessibility` §1's 48 floor. The thumb is 51×31 and is never the
  // target; the shipped acceptance screen put `onValueChange` on the
  // `Switch` itself, which is the defect this extraction fixes.
  it('makes the whole row the switch, not the thumb', () => {
    const onShareMetricsChange = jest.fn();
    render(<SharingControls {...props({ onShareMetricsChange })} />);

    fireEvent.press(screen.getByTestId('sharing-toggle-metrics'));

    expect(onShareMetricsChange).toHaveBeenCalledWith(false);
  });

  it('reads label and hint as one item, with its checked state', () => {
    render(<SharingControls {...props({ shareNutrition: true })} />);

    const row = screen.getByTestId('sharing-toggle-nutrition');
    expect(row.props.accessibilityRole).toBe('switch');
    expect(row.props.accessibilityLabel).toBe(
      `${SHARING_COPY.nutritionLabel}, ${SHARING_COPY.nutritionHint}`,
    );
    expect(row.props.accessibilityState.checked).toBe(true);
  });

  // The consent defect this extraction fixes. `account-lifecycle/07`'s own
  // table says progress photos are NEVER shared under any setting, and
  // `resource-registry.ts` gates nothing on `metrics_shared_from` — so the
  // shipped hint "Weight, measurements, progress photos." promised a coach
  // data the server does not give them, on the one screen where that is a
  // consent defect rather than a wording slip.
  it('never claims the body-metrics toggle covers progress photos', () => {
    render(<SharingControls {...props()} />);

    expect(SHARING_COPY.metricsHint).toBe('Your weight and measurements from before today.');
    expect(screen.queryByText(/progress photos/i)).toBeNull();
  });

  it('refuses both toggles while a write is in flight', () => {
    const onShareMetricsChange = jest.fn();
    render(<SharingControls {...props({ disabled: true, onShareMetricsChange })} />);

    fireEvent.press(screen.getByTestId('sharing-toggle-metrics'));

    expect(onShareMetricsChange).not.toHaveBeenCalled();
  });
});

describe('SharingControls — 200% text changes the control, not the copy', () => {
  it('swaps the segmented track for three selectable rows past 150%', () => {
    mockFontScale = 1.5;
    render(<SharingControls {...props()} />);

    expect(screen.queryByLabelText('Everything, tab 3 of 3')).toBeNull();
    const everything = screen.getByTestId('sharing-history-everything');
    expect(everything.props.accessibilityRole).toBe('radio');
    // Verbatim, not re-worded for the other shape — "Everything" is the
    // option's name in both (`accessibility` §2).
    expect(everything.props.accessibilityLabel).toBe('Everything');
    expect(
      screen.getByTestId('sharing-history-twelve_weeks').props.accessibilityState.checked,
    ).toBe(true);
  });

  it('still reports the option that was pressed', () => {
    mockFontScale = 2;
    const onHistorySharingChange = jest.fn();
    render(<SharingControls {...props({ onHistorySharingChange })} />);

    fireEvent.press(screen.getByTestId('sharing-history-nothing'));

    expect(onHistorySharingChange).toHaveBeenCalledWith('nothing');
  });

  it('groups the rows so they read as one choice', () => {
    mockFontScale = 2;
    render(<SharingControls {...props()} />);

    expect(screen.getByTestId('sharing-history-options').props.accessibilityRole).toBe(
      'radiogroup',
    );
  });
});

describe('NeverSharedNote', () => {
  // `account-lifecycle/07` step 2 required this line at acceptance too, and
  // the acceptance screen never rendered it. It ships inside the shared
  // module so both surfaces get it, and it is true before any query returns
  // and true after one fails.
  it('names the three categories that have no control at all', () => {
    render(<NeverSharedNote />);

    const block = screen.getByTestId('sharing-never-shared');
    expect(block.props.accessibilityLabel).toBe(
      `${SHARING_COPY.neverSharedTitle}. ${SHARING_COPY.neverSharedBody}`,
    );
    expect(SHARING_COPY.neverSharedBody).toContain('messages');
    expect(SHARING_COPY.neverSharedBody).toContain('check-ins');
    expect(SHARING_COPY.neverSharedBody).toContain('progress photos');
  });

  // Deliberately not three disabled toggles — a greyed control implies a
  // control that could be un-greyed. The absence is the feature.
  it('draws no control for any of them', () => {
    render(<SharingControls {...props()} />);

    expect(screen.queryByTestId('sharing-toggle-messages')).toBeNull();
    expect(screen.queryByTestId('sharing-toggle-checkins')).toBeNull();
    expect(screen.queryByTestId('sharing-toggle-photos')).toBeNull();
    expect(screen.getAllByRole('switch')).toHaveLength(2);
  });
});
