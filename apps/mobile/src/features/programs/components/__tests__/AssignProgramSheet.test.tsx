import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { AssignableClient } from '../../api/assignments.ts';
import { AssignProgramSheet } from '../AssignProgramSheet.tsx';

// `assignment/01`, frames A/B/E: single-client mode, the conflict card, and
// the footer's five label states. `assignment/02`'s bulk mode is out of
// scope for this file.

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function withSafeArea(children: ReactNode) {
  return <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>{children}</SafeAreaProvider>;
}

/** The first element of a query result — never `!`, per `code-conventions` §3. */
function firstOf<T>(items: readonly T[]): T {
  const [item] = items;
  if (!item) throw new Error('expected at least one match');
  return item;
}

const CLIENT_NO_PROGRAM: AssignableClient = {
  id: 'client-1',
  name: 'Priya Shah',
  status: 'active',
  activeAssignment: null,
};

const CLIENT_WITH_PROGRAM: AssignableClient = {
  id: 'client-2',
  name: 'Arjun Mehta',
  status: 'active',
  activeAssignment: {
    id: 'assignment-existing',
    programName: 'Base Strength',
    currentWeek: 3,
    durationWeeks: 8,
  },
};

const mockInvalidate = jest.fn();
const mockRefetch = jest.fn();
const mockCreateMutate = jest.fn();
const mockPauseMutate = jest.fn();
const mockCompleteMutate = jest.fn();
const mockTrackEvent = jest.fn();

interface AssignableClientsQueryState {
  data: { items: AssignableClient[] } | undefined;
  isPending: boolean;
  isError: boolean;
}

let mockAssignableClientsState: AssignableClientsQueryState = {
  data: { items: [CLIENT_NO_PROGRAM, CLIENT_WITH_PROGRAM] },
  isPending: false,
  isError: false,
};

let mockCreateIsPending = false;
let mockPauseIsPending = false;
let mockCompleteIsPending = false;

jest.mock('../../../../lib/trpc.ts', () => ({
  api: {
    useUtils: () => ({
      assignments: { assignableClients: { invalidate: mockInvalidate } },
    }),
    assignments: {
      assignableClients: {
        useQuery: () => ({ ...mockAssignableClientsState, refetch: mockRefetch }),
      },
      create: {
        useMutation: () => ({ mutate: mockCreateMutate, isPending: mockCreateIsPending }),
      },
      pause: {
        useMutation: () => ({ mutate: mockPauseMutate, isPending: mockPauseIsPending }),
      },
      complete: {
        useMutation: () => ({ mutate: mockCompleteMutate, isPending: mockCompleteIsPending }),
      },
    },
  },
}));

jest.mock('../../../../lib/analytics/index.ts', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  asUuid: (id: string) => id,
}));

jest.mock('../../../../lib/error-code.ts', () => ({
  getErrorCode: (error: unknown) => (error as { code?: string } | null)?.code ?? null,
  getErrorDetails: (error: unknown) => (error as { details?: unknown } | null)?.details ?? null,
}));

function renderSheet(overrides: Partial<Parameters<typeof AssignProgramSheet>[0]> = {}) {
  const onDismiss = jest.fn();
  const onAssigned = jest.fn();
  const onInviteClient = jest.fn();
  render(
    withSafeArea(
      <AssignProgramSheet
        isOpen
        mode="single"
        programId="program-1"
        programName="Hypertrophy Block"
        durationWeeks={8}
        onDismiss={onDismiss}
        onAssigned={onAssigned}
        onInviteClient={onInviteClient}
        {...overrides}
      />,
    ),
  );
  return { onDismiss, onAssigned, onInviteClient };
}

function openPicker() {
  fireEvent.press(firstOf(screen.getAllByText('Choose a client')));
}

beforeEach(() => {
  mockInvalidate.mockClear();
  mockRefetch.mockClear();
  mockCreateMutate.mockReset();
  mockPauseMutate.mockReset();
  mockCompleteMutate.mockReset();
  mockTrackEvent.mockClear();
  mockAssignableClientsState = {
    data: { items: [CLIENT_NO_PROGRAM, CLIENT_WITH_PROGRAM] },
    isPending: false,
    isError: false,
  };
  mockCreateIsPending = false;
  mockPauseIsPending = false;
  mockCompleteIsPending = false;
});

describe('AssignProgramSheet — unscoped, no client picked', () => {
  it('starts inert — the row and the footer both read "Choose a client"', () => {
    renderSheet();

    expect(screen.getAllByText('Choose a client')).toHaveLength(2);
  });

  it('opens the picker and becomes ready once a client with no active program is picked', async () => {
    renderSheet();

    openPicker();
    fireEvent.press(screen.getByText('Priya Shah'));

    expect(screen.getByText('Assign to Priya')).toBeTruthy();
    expect(screen.getByText('No active program')).toBeTruthy();
    expect(screen.queryByTestId('assign-conflict-card')).toBeNull();
  });
});

describe('AssignProgramSheet — conflict', () => {
  it('shows the conflict card and the inert footer once a client with an active assignment is picked', async () => {
    renderSheet();

    openPicker();
    fireEvent.press(await screen.findByText('Arjun Mehta'));

    expect(screen.getByTestId('assign-conflict-card')).toBeTruthy();
    expect(screen.getByText('Already on a program')).toBeTruthy();
    expect(
      screen.getByText(
        'Arjun is on Base Strength, week 3 of 8. Pause or mark it complete to start this one instead.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Pause or complete first')).toBeTruthy();

    const pauseButton = screen.getByTestId('assign-conflict-pause');
    expect(pauseButton.props.accessibilityLabel).toBe("Pause Arjun's current program");
    const completeButton = screen.getByTestId('assign-conflict-complete');
    expect(completeButton.props.accessibilityLabel).toBe(
      "Mark Arjun's current program as complete",
    );
  });

  it('collapses to a one-line confirmation and becomes ready after pausing', async () => {
    mockPauseMutate.mockImplementation((_input: unknown, opts?: { onSuccess?: () => void }) =>
      opts?.onSuccess?.(),
    );
    renderSheet();

    openPicker();
    fireEvent.press(await screen.findByText('Arjun Mehta'));
    fireEvent.press(screen.getByTestId('assign-conflict-pause'));

    expect(mockPauseMutate).toHaveBeenCalledWith(
      { assignmentId: 'assignment-existing' },
      expect.anything(),
    );
    expect(screen.getByText('Paused — you can assign now.')).toBeTruthy();
    expect(screen.getByText('Assign to Arjun')).toBeTruthy();
    expect(mockInvalidate).toHaveBeenCalled();
  });

  it('collapses to a one-line confirmation and becomes ready after marking complete', async () => {
    mockCompleteMutate.mockImplementation((_input: unknown, opts?: { onSuccess?: () => void }) =>
      opts?.onSuccess?.(),
    );
    renderSheet();

    openPicker();
    fireEvent.press(await screen.findByText('Arjun Mehta'));
    fireEvent.press(screen.getByTestId('assign-conflict-complete'));

    expect(mockCompleteMutate).toHaveBeenCalledWith(
      { assignmentId: 'assignment-existing' },
      expect.anything(),
    );
    expect(screen.getByText('Marked complete — you can assign now.')).toBeTruthy();
    expect(screen.getByText('Assign to Arjun')).toBeTruthy();
  });

  it('surfaces a conflict the server reports at submit time even if the local picture missed it', async () => {
    mockCreateMutate.mockImplementation(
      (_input: unknown, opts?: { onError?: (error: unknown) => void }) => {
        opts?.onError?.({
          code: 'CLIENT_ALREADY_HAS_ACTIVE_ASSIGNMENT',
          details: {
            assignmentId: 'race-assignment',
            programName: 'Race Program',
            currentWeek: 2,
            durationWeeks: 5,
          },
        });
      },
    );
    renderSheet();

    openPicker();
    fireEvent.press(await screen.findByText('Priya Shah'));
    fireEvent.press(screen.getByText('Assign to Priya'));

    expect(
      screen.getByText(
        'Priya is on Race Program, week 2 of 5. Pause or mark it complete to start this one instead.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Pause or complete first')).toBeTruthy();
  });
});

describe('AssignProgramSheet — footer states', () => {
  it('reads "Assigning…" while the create mutation is in flight', async () => {
    mockCreateIsPending = true;
    renderSheet();

    openPicker();
    fireEvent.press(await screen.findByText('Priya Shah'));

    expect(screen.getByText('Assigning…')).toBeTruthy();
  });

  it('calls onAssigned and fires program_assigned on a successful submit', async () => {
    mockCreateMutate.mockImplementation(
      (_input: unknown, opts?: { onSuccess?: (result: { id: string }) => void }) =>
        opts?.onSuccess?.({ id: 'new-assignment' }),
    );
    const { onAssigned } = renderSheet();

    openPicker();
    fireEvent.press(await screen.findByText('Priya Shah'));
    fireEvent.press(screen.getByText('Assign to Priya'));

    expect(mockCreateMutate).toHaveBeenCalledWith(
      { programId: 'program-1', clientId: 'client-1', startDate: expect.any(String) },
      expect.anything(),
    );
    expect(onAssigned).toHaveBeenCalledWith({ id: 'new-assignment', clientId: 'client-1' });
    expect(mockTrackEvent).toHaveBeenCalledWith('program_assigned', {
      client_id: 'client-1',
      program_id: 'program-1',
      week_count: 8,
    });
  });

  it('shows an inline error, not the conflict card, on a genuine server/network failure', async () => {
    mockCreateMutate.mockImplementation(
      (_input: unknown, opts?: { onError?: (error: unknown) => void }) =>
        opts?.onError?.({ code: null }),
    );
    renderSheet();

    openPicker();
    fireEvent.press(await screen.findByText('Priya Shah'));
    fireEvent.press(screen.getByText('Assign to Priya'));

    const error = await screen.findByTestId('assign-error');
    expect(error.props.accessibilityRole).toBe('alert');
    expect(screen.queryByTestId('assign-conflict-card')).toBeNull();
  });
});

describe('AssignProgramSheet — scoped to a client', () => {
  it('renders the client as inert text and the "opened from" note, with no picker trigger', () => {
    renderSheet({ initialClient: { clientId: 'client-1', name: 'Priya Shah' } });

    const row = screen.getByTestId('assign-client-row');
    expect(row.props.accessibilityRole).toBe('text');
    expect(row.props.accessibilityLabel).toBe('Client, Priya, no active program');
    expect(screen.getByTestId('assign-scoped-note').props.children).toBe(
      "Opened from Priya's profile, so the client is set.",
    );
    expect(screen.getByText('Assign to Priya')).toBeTruthy();
  });
});

describe('AssignProgramSheet — empty roster', () => {
  it("shows the picker's empty state and routes its action to onInviteClient", async () => {
    mockAssignableClientsState = { data: { items: [] }, isPending: false, isError: false };
    const { onInviteClient } = renderSheet();

    openPicker();

    expect(await screen.findByTestId('assign-client-picker-empty')).toBeTruthy();
    expect(screen.getByText('No clients yet')).toBeTruthy();

    fireEvent.press(screen.getByText('Invite a client'));
    expect(onInviteClient).toHaveBeenCalled();
  });

  it('shows a loading skeleton while the roster is in flight', () => {
    mockAssignableClientsState = { data: undefined, isPending: true, isError: false };
    renderSheet();

    openPicker();
    expect(screen.getByLabelText('Loading your clients')).toBeTruthy();
  });
});
