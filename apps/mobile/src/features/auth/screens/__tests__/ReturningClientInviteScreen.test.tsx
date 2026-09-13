import { fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SHARING_COPY } from '../../../onboarding/components/SharingControls.tsx';
import {
  ReturningClientInviteScreen,
  type ReturningClientInviteScreenProps,
} from '../ReturningClientInviteScreen.tsx';

// jest-expo's `Dimensions` fixture reports `fontScale: 2`, past the 1.5 at
// which `SharingControls` swaps to its radio rows. Pinned to 1 so these
// cases exercise the ordinary shape.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));

// `AuthScreenShell` renders the ambient `PulseRingBackground`, which calls
// `useReducedMotion` straight from `react-native-reanimated` — absent from
// the Jest mock. Same stub every other auth-screen test uses.
jest.mock('../../components/PulseRingBackground.tsx', () => ({
  PulseRingBackground: () => null,
}));

// `AuthScreenShell` reads `useSafeAreaInsets`, which throws without a
// provider ancestor. `initialWindowMetrics` reads a native module that does
// not exist under Jest, so metrics are supplied by hand.
const TEST_METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  frame: { x: 0, y: 0, width: 390, height: 844 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={TEST_METRICS}>{ui}</SafeAreaProvider>);
}

function props(
  overrides: Partial<ReturningClientInviteScreenProps> = {},
): ReturningClientInviteScreenProps {
  return {
    coachName: 'Marcus Bell',
    isLoadingCoach: false,
    historySharing: 'twelve_weeks',
    onHistorySharingChange: jest.fn(),
    shareMetrics: false,
    onShareMetricsChange: jest.fn(),
    shareNutrition: false,
    onShareNutritionChange: jest.fn(),
    onAccept: jest.fn(),
    isAccepting: false,
    onSignOut: jest.fn(),
    ...overrides,
  };
}

describe('ReturningClientInviteScreen — the three decisions', () => {
  it('puts all three on screen with none pre-decided behind a disclosure', () => {
    render(<ReturningClientInviteScreen {...props()} />);

    expect(screen.getByLabelText('Nothing, tab 1 of 3')).toBeTruthy();
    expect(screen.getByTestId('sharing-toggle-metrics')).toBeTruthy();
    expect(screen.getByTestId('sharing-toggle-nutrition')).toBeTruthy();
  });

  it('reports each decision to the flow that holds it', () => {
    const onHistorySharingChange = jest.fn();
    const onShareNutritionChange = jest.fn();
    render(
      <ReturningClientInviteScreen
        {...props({ onHistorySharingChange, onShareNutritionChange })}
      />,
    );

    fireEvent.press(screen.getByLabelText('Everything, tab 3 of 3'));
    fireEvent.press(screen.getByTestId('sharing-toggle-nutrition'));

    expect(onHistorySharingChange).toHaveBeenCalledWith('everything');
    expect(onShareNutritionChange).toHaveBeenCalledWith(true);
  });

  it('addresses the coach by first name, never the full one, in the control', () => {
    render(<ReturningClientInviteScreen {...props()} />);

    expect(
      screen.getByText('Workouts and logged sets from before you joined Marcus.'),
    ).toBeTruthy();
  });

  it('says "them" rather than a blank while the preview is still resolving', () => {
    render(<ReturningClientInviteScreen {...props({ coachName: undefined })} />);

    expect(screen.getByText('Workouts and logged sets from before you joined them.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept invite' })).toBeTruthy();
  });
});

describe('ReturningClientInviteScreen — the three defects the extraction fixed', () => {
  // The shipped hint read "Weight, measurements, progress photos." — but
  // `account-lifecycle/07`'s table says photos are never shared under any
  // setting, so the copy promised a coach something the server does not
  // give them, on a consent surface.
  it('no longer claims the body-metrics toggle covers progress photos', () => {
    render(<ReturningClientInviteScreen {...props()} />);

    expect(screen.getByText(SHARING_COPY.metricsHint)).toBeTruthy();
    expect(screen.queryByText('Weight, measurements, progress photos.')).toBeNull();
  });

  // `onValueChange` used to sit on the `Switch`, making the target 51×31 —
  // under `accessibility` §1's 48 floor.
  it('makes the whole row the switch rather than the thumb', () => {
    const onShareMetricsChange = jest.fn();
    render(<ReturningClientInviteScreen {...props({ onShareMetricsChange })} />);

    const row = screen.getByTestId('sharing-toggle-metrics');
    expect(row.props.accessibilityRole).toBe('switch');
    fireEvent.press(row);
    expect(onShareMetricsChange).toHaveBeenCalledWith(true);
  });

  // `account-lifecycle/07` step 2 required this line here and the screen
  // never rendered it. It ships inside the shared module, so acceptance
  // gets it for free.
  it('states what is never shared, whatever the client chooses', () => {
    render(<ReturningClientInviteScreen {...props()} />);

    expect(screen.getByTestId('sharing-never-shared')).toBeTruthy();
    expect(screen.getByText(SHARING_COPY.neverSharedBody)).toBeTruthy();
  });
});

describe('ReturningClientInviteScreen — the states around the decision', () => {
  it('shows a skeleton while the invite preview is in flight', () => {
    render(<ReturningClientInviteScreen {...props({ isLoadingCoach: true })} />);

    expect(screen.getByLabelText('Loading your invite')).toBeTruthy();
    expect(screen.queryByTestId('sharing-toggle-metrics')).toBeNull();
  });

  it('offers no sharing decision when the invite could not be opened', () => {
    render(<ReturningClientInviteScreen {...props({ previewError: 'That code has expired.' })} />);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByTestId('sharing-toggle-metrics')).toBeNull();
  });

  it('names the coach on the accept button once it knows one', () => {
    const onAccept = jest.fn();
    render(<ReturningClientInviteScreen {...props({ onAccept })} />);

    fireEvent.press(screen.getByRole('button', { name: 'Join Marcus Bell' }));

    expect(onAccept).toHaveBeenCalled();
  });
});
