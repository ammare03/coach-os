import { fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { YourDataScreen } from '../YourDataScreen.tsx';

// `useSafeAreaInsets` (used for the glass nav bar's inset padding) throws
// without a provider ancestor. `initialWindowMetrics` reads from a native
// module that doesn't exist under Jest (resolves to `null`), so metrics are
// supplied by hand rather than relying on it.
const TEST_METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  frame: { x: 0, y: 0, width: 390, height: 844 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={TEST_METRICS}>{ui}</SafeAreaProvider>);
}

const mockMutate = jest.fn();
const mockDownload = jest.fn();
const mockRefetch = jest.fn();
interface MockHook {
  history: { data: { items: unknown[] } | undefined; isError: boolean; refetch: () => void };
  status: { data: Record<string, unknown> | undefined } | undefined;
  requestExport: {
    mutate: () => void;
    isPending: boolean;
    error: { data?: { appCode: string } } | undefined;
  };
  download: (id: string) => void;
}
let mockHook: MockHook;

jest.mock('../../hooks/useExport.ts', () => ({
  useExport: () => mockHook,
}));

function baseHook() {
  return {
    history: { data: { items: [] }, isError: false, refetch: mockRefetch },
    status: undefined,
    requestExport: { mutate: mockMutate, isPending: false, error: undefined },
    download: mockDownload,
  };
}

describe('YourDataScreen', () => {
  beforeEach(() => {
    mockMutate.mockClear();
    mockDownload.mockClear();
    mockRefetch.mockClear();
    mockHook = baseHook();
  });

  it('always shows the explanatory copy and a working request button, even if history failed', () => {
    mockHook.history = { data: undefined, isError: true, refetch: mockRefetch };
    render(<YourDataScreen onBack={jest.fn()} />);

    expect(
      screen.getByText("Everything you've logged in CoachOS is yours. Download a copy any time."),
    ).toBeTruthy();
    expect(screen.getByText("Couldn't load previous exports.")).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Request export'));
    expect(mockMutate).toHaveBeenCalled();
  });

  it('shows real progress, not a spinner, while building — and hides the request button', () => {
    mockHook.status = { data: { status: 'building', progressPercent: 42 } };
    render(<YourDataScreen onBack={jest.fn()} />);

    expect(screen.getByText('42%')).toBeTruthy();
    expect(screen.queryByLabelText('Request export')).toBeNull();
    expect(screen.getByText(/leave this screen/)).toBeTruthy();
  });

  it('shows the failed card without blame, and still offers the request button', () => {
    mockHook.history = {
      data: {
        items: [
          { id: 'e1', status: 'failed', createdAt: new Date(), bytes: null, expiresAt: null },
        ],
      },
      isError: false,
      refetch: mockRefetch,
    };
    render(<YourDataScreen onBack={jest.fn()} />);

    expect(screen.getByText("We couldn't build your export. Try again.")).toBeTruthy();
    expect(screen.getByLabelText('Request export')).toBeTruthy();
  });

  it('shows an expired row as greyed, not as an error', () => {
    mockHook.history = {
      data: {
        items: [
          { id: 'e1', status: 'expired', createdAt: new Date(), bytes: null, expiresAt: null },
        ],
      },
      isError: false,
      refetch: mockRefetch,
    };
    render(<YourDataScreen onBack={jest.fn()} />);

    expect(screen.getByLabelText(/Expired\. Exports are available for 7 days/)).toBeTruthy();
  });

  it('lets a ready export be downloaded by tapping its row', () => {
    mockHook.history = {
      data: {
        items: [
          {
            id: 'e1',
            status: 'ready',
            createdAt: new Date(),
            bytes: 88 * 1024 * 1024,
            expiresAt: new Date(Date.now() + 4 * 86_400_000),
          },
        ],
      },
      isError: false,
      refetch: mockRefetch,
    };
    render(<YourDataScreen onBack={jest.fn()} />);

    fireEvent.press(screen.getByLabelText(/Ready.*expires in 4 days/));
    expect(mockDownload).toHaveBeenCalledWith('e1');
  });

  it('points the rate-limited state at the still-valid previous export', () => {
    mockHook.history = {
      data: {
        items: [
          {
            id: 'e1',
            status: 'ready',
            createdAt: new Date(),
            bytes: 1024,
            expiresAt: new Date(Date.now() + 4 * 86_400_000),
          },
        ],
      },
      isError: false,
      refetch: mockRefetch,
    };
    mockHook.requestExport = {
      mutate: mockMutate,
      isPending: false,
      error: { data: { appCode: 'EXPORT_RATE_LIMITED' } },
    };
    render(<YourDataScreen onBack={jest.fn()} />);

    expect(screen.getByText(/still available for 4 more days/)).toBeTruthy();
    fireEvent.press(screen.getByText('Download'));
    expect(mockDownload).toHaveBeenCalledWith('e1');
  });

  it('calls onBack when the back button is pressed', () => {
    const onBack = jest.fn();
    render(<YourDataScreen onBack={onBack} />);

    fireEvent.press(screen.getByLabelText('Back'));
    expect(onBack).toHaveBeenCalled();
  });
});
