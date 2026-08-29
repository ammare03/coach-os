import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';

import { useExport } from '../useExport.ts';

const mockInvalidate = jest.fn();
const mockFetch = jest.fn();
let mockHistoryData: { items: { id: string; status: string }[] } | undefined;
let mockStatusData: { status: string; progressPercent: number } | undefined;
let mockRequestExportOpts: {
  onSuccess?: (result: { exportId: string }) => void;
  onError?: (error: { data?: { appCode: string; details?: unknown } }) => void;
  onSettled?: () => void;
} = {};

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(),
}));

jest.mock('../../../../lib/trpc.ts', () => ({
  api: {
    me: {
      exportHistory: {
        useQuery: () => ({ data: mockHistoryData }),
      },
      exportStatus: {
        useQuery: (_input: unknown, opts: { enabled: boolean }) =>
          opts.enabled ? { data: mockStatusData } : { data: undefined },
      },
      requestExport: {
        useMutation: (opts: typeof mockRequestExportOpts) => {
          mockRequestExportOpts = opts;
          return { mutate: jest.fn(), isPending: false };
        },
      },
    },
    useUtils: () => ({
      me: {
        exportHistory: { invalidate: mockInvalidate },
        exportDownloadUrl: { fetch: mockFetch },
      },
    }),
  },
}));

describe('useExport', () => {
  beforeEach(() => {
    mockInvalidate.mockClear();
    mockFetch.mockClear();
    (WebBrowser.openBrowserAsync as jest.Mock).mockClear();
    mockHistoryData = { items: [] };
    mockStatusData = undefined;
    mockRequestExportOpts = {};
  });

  it('tracks the export named by EXPORT_ALREADY_RUNNING as the active one', () => {
    const { result } = renderHook(() => useExport());

    act(() => {
      mockRequestExportOpts.onError?.({
        data: { appCode: 'EXPORT_ALREADY_RUNNING', details: { exportId: 'e1' } },
      });
    });

    expect(result.current.activeId).toBe('e1');
  });

  it('prefers the server-reported active export from history over a local one', () => {
    mockHistoryData = { items: [{ id: 'server-active', status: 'building' }] };
    const { result } = renderHook(() => useExport());

    expect(result.current.activeId).toBe('server-active');
  });

  it('invalidates history once the tracked export reaches a terminal state', async () => {
    mockHistoryData = { items: [{ id: 'e1', status: 'building' }] };
    mockStatusData = { status: 'ready', progressPercent: 100 };
    renderHook(() => useExport());

    await waitFor(() => expect(mockInvalidate).toHaveBeenCalled());
  });

  it('opens the signed URL in the system browser on download, never in-app', async () => {
    mockFetch.mockResolvedValue({ downloadUrl: 'https://example.com/signed' });
    const { result } = renderHook(() => useExport());

    await act(async () => {
      await result.current.download('e1');
    });

    expect(mockFetch).toHaveBeenCalledWith({ exportId: 'e1' });
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://example.com/signed');
  });

  it('does nothing when the download URL is not ready', async () => {
    mockFetch.mockResolvedValue({ downloadUrl: null });
    const { result } = renderHook(() => useExport());

    await act(async () => {
      await result.current.download('e1');
    });

    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
  });
});
