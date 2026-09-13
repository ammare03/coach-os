import { ToastProvider } from '@coachos/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Pressable, Text } from 'react-native';

import { clientDetailKeys, type ClientOverview } from '../../api.ts';
import { useClientStatus } from '../useClientStatus.ts';
import { COACH_DASHBOARD_QUERY_KEY, type CoachDashboard } from '../useCoachDashboard.ts';

// **The deferred-commit contract, asserted against real TanStack Query and
// the real toast.** Only the network is faked: a stubbed mutation result
// would pass whether or not either cache was ever patched, and the whole
// point of this hook is what happens to those two entries between the tap
// and the window closing.
//
// The sharp edge this file exists for: during an open pause window the
// SERVER still believes the client is active, so anything else the coach
// starts would race a mutation that has not been sent. Resume inside the
// window must therefore be the undo — never a second mutation.

const CLIENT_ID = '01924f2c-0000-7000-8000-00000000000a';
const OTHER_ID = '01924f2c-0000-7000-8000-00000000000b';
const UNDO_WINDOW_MS = 5000;

let mockSetStatus: jest.Mock;
let mockRelease: jest.Mock;
let mockTrackEvent: jest.Mock;

jest.mock('../../../../lib/trpc.ts', () => ({
  api: {
    useUtils: () => ({
      client: {
        coach: {
          clients: {
            setStatus: { mutate: (input: unknown) => mockSetStatus(input) },
            release: { mutate: (input: unknown) => mockRelease(input) },
          },
        },
      },
    }),
  },
}));

jest.mock('../../../../lib/analytics/index.ts', () => ({
  trackEvent: (name: string, properties: unknown) => mockTrackEvent(name, properties),
  asUuid: (id: string) => id,
}));

function makeOverview(status: ClientOverview['status'] = 'active'): ClientOverview {
  return {
    clientId: CLIENT_ID,
    name: 'Priya Sharma',
    status,
    goal: 'fat_loss',
    avatarAssetId: null,
    coachSince: new Date('2026-03-01T00:00:00.000Z'),
    injuries: [],
    weightTrend: [],
    adherence: {
      sessionsCompleted7d: 4,
      sessionsScheduled7d: 5,
      trainingAdherence: 80,
      nutritionAdherence: 95,
      overallAdherence: 86,
      state: 'on-track',
      trend: [],
    },
    program: null,
    nextCheckin: null,
    pinnedNotes: [],
  } as unknown as ClientOverview;
}

function makeDashboardClient(clientId: string, status: ClientOverview['status'] = 'active') {
  return {
    clientId,
    name: clientId === CLIENT_ID ? 'Priya Sharma' : 'Dev Kulkarni',
    status,
    goal: 'fat_loss',
    avatarAssetId: null,
    unreadMessages: 0,
    lastActiveAt: null,
    sessionsCompleted7d: 4,
    sessionsScheduled7d: 5,
    unreviewedSessions: 0,
    unreviewedVideos: 0,
    latestWeightKg: null,
    trainingAdherence: 80,
    nutritionAdherence: 95,
    overallAdherence: 86,
    adherenceColor: 'green',
  };
}

function makeDashboard(): CoachDashboard {
  return {
    offTrack: 0,
    needsReview: 0,
    checkinsDue: 0,
    clients: [makeDashboardClient(CLIENT_ID), makeDashboardClient(OTHER_ID)],
  } as unknown as CoachDashboard;
}

const overviewKey = clientDetailKeys.tab(CLIENT_ID, 'overview');

let queryClient: QueryClient;
let onReleased: jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

function setup() {
  return renderHook(() => useClientStatus(CLIENT_ID, { firstName: 'Priya', onReleased }), {
    wrapper,
  });
}

function readOverviewStatus(): ClientOverview['status'] | undefined {
  return queryClient.getQueryData<ClientOverview>(overviewKey)?.status;
}

function readRowStatus(clientId: string): string | undefined {
  return queryClient
    .getQueryData<CoachDashboard>(COACH_DASHBOARD_QUERY_KEY)
    ?.clients.find((client) => client.clientId === clientId)?.status;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockSetStatus = jest.fn().mockResolvedValue({
    clientId: CLIENT_ID,
    status: 'paused',
    activatedAt: new Date('2026-03-01T00:00:00.000Z'),
    pausedAt: new Date('2026-09-11T06:30:00.000Z'),
    archivedAt: null,
  });
  mockRelease = jest.fn().mockResolvedValue({ success: true });
  mockTrackEvent = jest.fn();
  onReleased = jest.fn();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(overviewKey, makeOverview());
  queryClient.setQueryData(COACH_DASHBOARD_QUERY_KEY, makeDashboard());
});

afterEach(() => {
  jest.useRealTimers();
  queryClient.clear();
});

describe('pause — optimistic now, sent later', () => {
  it('marks the client paused in both cache entries before anything is sent', async () => {
    const { result } = setup();

    await act(async () => {
      result.current.pause();
    });

    expect(readOverviewStatus()).toBe('paused');
    expect(readRowStatus(CLIENT_ID)).toBe('paused');
    // The header chip and the Overview tab share ONE cache entry
    // (`useClientIdentity` narrows it with `select`), so patching the
    // overview is what moves the chip — there is no third entry.
    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  it('touches no other client on the dashboard', async () => {
    const { result } = setup();

    await act(async () => {
      result.current.pause();
    });

    expect(readRowStatus(OTHER_ID)).toBe('active');
  });

  it('sends exactly one mutation when the window closes untaken', async () => {
    const { result } = setup();

    await act(async () => {
      result.current.pause();
    });
    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    expect(mockSetStatus).toHaveBeenCalledTimes(1);
    expect(mockSetStatus).toHaveBeenCalledWith({ clientId: CLIENT_ID, status: 'paused' });
  });

  it('emits client_paused on the COMMIT, carrying an id and nothing else', async () => {
    const { result } = setup();

    await act(async () => {
      result.current.pause();
    });
    expect(mockTrackEvent).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    // An undone pause never happened, so the event belongs to the commit.
    expect(mockTrackEvent).toHaveBeenCalledWith('client_paused', { client_id: CLIENT_ID });
  });

  it('holds the other two rows inert until the write has landed', async () => {
    const { result } = setup();

    expect(result.current.isPending).toBe(false);

    await act(async () => {
      result.current.pause();
    });
    expect(result.current.isPending).toBe(true);

    // The window closing does not end it — the mutation it released is now
    // in flight, and archiving on top of an unacknowledged pause is the
    // race this flag exists to prevent.
    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS);
    });
    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });
  });
});

describe('undo, inside the window', () => {
  it('puts both cache entries back and sends nothing at all', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <UndoHarness />
        </ToastProvider>
      </QueryClientProvider>,
    );

    await act(async () => {
      fireEvent.press(screen.getByLabelText('pause'));
    });
    expect(readOverviewStatus()).toBe('paused');

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    });

    expect(readOverviewStatus()).toBe('active');
    expect(readRowStatus(CLIENT_ID)).toBe('active');

    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS * 2);
    });

    // Nothing was ever sent, so there is no delete to reverse — the
    // deferred-commit default (`useUndoToast`).
    expect(mockSetStatus).not.toHaveBeenCalled();
    expect(mockTrackEvent).not.toHaveBeenCalled();
  });
});

describe('resume inside an open pause window', () => {
  it('cancels the pending commit rather than sending a second mutation', async () => {
    const { result } = setup();

    await act(async () => {
      result.current.pause();
    });
    await act(async () => {
      result.current.resume();
    });
    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS * 2);
    });

    expect(readOverviewStatus()).toBe('active');
    expect(mockSetStatus).not.toHaveBeenCalled();
    expect(mockTrackEvent).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(false);
  });
});

describe('resume on a client the server already believes is paused', () => {
  it('commits status active when its own window closes', async () => {
    queryClient.setQueryData(overviewKey, makeOverview('paused'));
    const { result } = setup();

    await act(async () => {
      result.current.resume();
    });
    expect(readOverviewStatus()).toBe('active');

    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    expect(mockSetStatus).toHaveBeenCalledWith({ clientId: CLIENT_ID, status: 'active' });
    // No `client_resumed` — a resume is derivable from the committed pause.
    expect(mockTrackEvent).not.toHaveBeenCalled();
  });
});

describe('archive — immediate, behind the typed word', () => {
  it('patches both entries and sends at once', async () => {
    const { result } = setup();

    await act(async () => {
      result.current.archive();
    });

    expect(mockSetStatus).toHaveBeenCalledWith({ clientId: CLIENT_ID, status: 'archived' });
    expect(readOverviewStatus()).toBe('archived');
    expect(readRowStatus(CLIENT_ID)).toBe('archived');
    expect(mockTrackEvent).toHaveBeenCalledWith('client_archived', { client_id: CLIENT_ID });
  });

  it('rolls both entries back when the server refuses', async () => {
    mockSetStatus = jest.fn().mockRejectedValue(new Error('CLIENT_ARCHIVED'));
    const { result } = setup();

    await act(async () => {
      result.current.archive();
    });

    expect(readOverviewStatus()).toBe('active');
    expect(readRowStatus(CLIENT_ID)).toBe('active');
    expect(mockTrackEvent).not.toHaveBeenCalled();
  });
});

describe('release — immediate, behind the typed word', () => {
  it('detaches the client and tells the route to leave', async () => {
    const { result } = setup();

    await act(async () => {
      result.current.release();
    });

    expect(mockRelease).toHaveBeenCalledWith({ clientId: CLIENT_ID });
    // The row goes: the client is no longer this coach's.
    expect(readRowStatus(CLIENT_ID)).toBeUndefined();
    expect(readRowStatus(OTHER_ID)).toBe('active');
    expect(mockTrackEvent).toHaveBeenCalledWith('client_released', { client_id: CLIENT_ID });
    expect(onReleased).toHaveBeenCalledTimes(1);
  });

  it('puts the row back and stays put when the server refuses', async () => {
    mockRelease = jest.fn().mockRejectedValue(new Error('offline'));
    const { result } = setup();

    await act(async () => {
      result.current.release();
    });

    expect(readRowStatus(CLIENT_ID)).toBe('active');
    expect(onReleased).not.toHaveBeenCalled();
  });
});

/** A pressable seam, so `Undo` can be tapped on the real toast. */
function UndoHarness() {
  const controls = useClientStatus(CLIENT_ID, { firstName: 'Priya', onReleased });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="pause"
      onPress={() => {
        controls.pause();
      }}
    >
      <Text>pause</Text>
    </Pressable>
  );
}
