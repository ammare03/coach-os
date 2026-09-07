import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { AssignableClient } from '../../api/assignments.ts';
import { AssignProgramSheet } from '../AssignProgramSheet.tsx';

// `assignment/01`, frames A/B/E: single-client mode, the conflict card, and
// the footer's five label states. `assignment/02`, frames C/D: bulk mode's
// multi-select, footer singular/plural labels, and the outcome view with
// and without conflicts.

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
const mockBulkCreateMutate = jest.fn();
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
let mockBulkCreateIsPending = false;
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
      bulkCreate: {
        useMutation: () => ({ mutate: mockBulkCreateMutate, isPending: mockBulkCreateIsPending }),
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

function renderBulkSheet(overrides: Partial<Parameters<typeof AssignProgramSheet>[0]> = {}) {
  const onDismiss = jest.fn();
  const onAssigned = jest.fn();
  const onInviteClient = jest.fn();
  render(
    withSafeArea(
      <AssignProgramSheet
        isOpen
        mode="bulk"
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

beforeEach(() => {
  mockInvalidate.mockClear();
  mockRefetch.mockClear();
  mockCreateMutate.mockReset();
  mockBulkCreateMutate.mockReset();
  mockPauseMutate.mockReset();
  mockCompleteMutate.mockReset();
  mockTrackEvent.mockClear();
  mockAssignableClientsState = {
    data: { items: [CLIENT_NO_PROGRAM, CLIENT_WITH_PROGRAM] },
    isPending: false,
    isError: false,
  };
  mockCreateIsPending = false;
  mockBulkCreateIsPending = false;
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

describe('AssignProgramSheet — bulk mode, frame C: multi-select', () => {
  it('starts with none selected and the inert footer', () => {
    renderBulkSheet();

    expect(screen.getByText('Clients · 0 selected')).toBeTruthy();
    expect(screen.getByText('Select clients to assign')).toBeTruthy();
  });

  it('selecting clients updates the eyebrow count, the checkbox state, and the footer label — plural then singular', () => {
    renderBulkSheet();

    fireEvent.press(screen.getByTestId('assign-bulk-client-client-1'));
    expect(screen.getByText('Clients · 1 selected')).toBeTruthy();
    expect(screen.getByTestId('assign-bulk-client-client-1').props.accessibilityState.checked).toBe(
      true,
    );
    expect(screen.getByText('Assign to 1 client')).toBeTruthy();

    fireEvent.press(screen.getByTestId('assign-bulk-client-client-2'));
    expect(screen.getByText('Clients · 2 selected')).toBeTruthy();
    expect(screen.getByText('Assign to 2 clients')).toBeTruthy();

    // Toggling one back off returns to the singular label.
    fireEvent.press(screen.getByTestId('assign-bulk-client-client-1'));
    expect(screen.getByText('Clients · 1 selected')).toBeTruthy();
    expect(screen.getByText('Assign to 1 client')).toBeTruthy();
  });

  it('carries the name as the accessible label and the status line as the hint, separately', () => {
    renderBulkSheet();

    const arjunRow = screen.getByTestId('assign-bulk-client-client-2');
    expect(arjunRow.props.accessibilityRole).toBe('checkbox');
    expect(arjunRow.props.accessibilityLabel).toBe('Arjun Mehta');
    expect(arjunRow.props.accessibilityHint).toBe('On Base Strength');
  });

  it('a client already on a program is selectable, never pre-checked or blocked in the picker', () => {
    renderBulkSheet();

    const arjunRow = screen.getByTestId('assign-bulk-client-client-2');
    expect(arjunRow.props.accessibilityState.checked).toBe(false);

    fireEvent.press(arjunRow);
    expect(screen.getByTestId('assign-bulk-client-client-2').props.accessibilityState.checked).toBe(
      true,
    );
  });

  it('shows the quiet "No clients match" line for a search with no results, not the illustrated empty state', () => {
    renderBulkSheet();

    fireEvent.changeText(screen.getByTestId('assign-bulk-search'), 'nobody here');

    expect(screen.getByTestId('assign-bulk-no-match')).toBeTruthy();
    expect(screen.getByText('No clients match')).toBeTruthy();
    expect(screen.queryByTestId('assign-bulk-empty')).toBeNull();
  });

  it("shows the picker's empty state and routes its action to onInviteClient when there are no clients at all", () => {
    mockAssignableClientsState = { data: { items: [] }, isPending: false, isError: false };
    const { onInviteClient } = renderBulkSheet();

    expect(screen.getByTestId('assign-bulk-empty')).toBeTruthy();
    fireEvent.press(screen.getByText('Invite a client'));
    expect(onInviteClient).toHaveBeenCalled();
  });

  it('reads "Assigning…" while the bulk mutation is in flight', () => {
    mockBulkCreateIsPending = true;
    renderBulkSheet();

    fireEvent.press(screen.getByTestId('assign-bulk-client-client-1'));
    expect(screen.getByText('Assigning…')).toBeTruthy();
  });

  it('submits every selected client id and fires program_assigned once per succeeded client, announcing the outcome once', () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    mockBulkCreateMutate.mockImplementation(
      (_input: unknown, opts?: { onSuccess?: (result: unknown) => void }) =>
        opts?.onSuccess?.({
          succeeded: [{ clientId: 'client-1', assignmentId: 'new-1' }],
          conflicted: [],
        }),
    );
    renderBulkSheet();

    fireEvent.press(screen.getByTestId('assign-bulk-client-client-1'));
    fireEvent.press(screen.getByText('Assign to 1 client'));

    expect(mockBulkCreateMutate).toHaveBeenCalledWith(
      { programId: 'program-1', clientIds: ['client-1'], startDate: expect.any(String) },
      expect.anything(),
    );
    expect(mockTrackEvent).toHaveBeenCalledWith('program_assigned', {
      client_id: 'client-1',
      program_id: 'program-1',
      week_count: 8,
    });
    expect(announce).toHaveBeenCalledWith('1 of 1 client assigned.');
  });
});

describe('AssignProgramSheet — bulk mode, frame D: outcome view', () => {
  function submitBulk(result: {
    succeeded: { clientId: string; assignmentId: string }[];
    conflicted: {
      clientId: string;
      assignmentId: string;
      programName: string;
      currentWeek: number;
      durationWeeks: number;
    }[];
  }) {
    mockBulkCreateMutate.mockImplementation(
      (_input: unknown, opts?: { onSuccess?: (r: unknown) => void }) => opts?.onSuccess?.(result),
    );
    const rendered = renderBulkSheet();
    fireEvent.press(screen.getByTestId('assign-bulk-client-client-1'));
    fireEvent.press(screen.getByTestId('assign-bulk-client-client-2'));
    fireEvent.press(screen.getByText('Assign to 2 clients'));
    return rendered;
  }

  it('shows both stat tiles and both sections for a mix of succeeded and conflicted outcomes', () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    submitBulk({
      succeeded: [{ clientId: 'client-1', assignmentId: 'new-1' }],
      conflicted: [
        {
          clientId: 'client-2',
          assignmentId: 'assignment-existing',
          programName: 'Base Strength',
          currentWeek: 3,
          durationWeeks: 8,
        },
      ],
    });

    expect(screen.getByText('Assignment results')).toBeTruthy();
    expect(screen.getByTestId('assign-outcome-stat-assigned')).toBeTruthy();
    expect(screen.getByTestId('assign-outcome-stat-attention')).toBeTruthy();
    expect(screen.getByText('Assigned · 1')).toBeTruthy();
    expect(screen.getByText('Needs attention · 1')).toBeTruthy();
    expect(screen.getByTestId('assign-outcome-succeeded-client-1')).toBeTruthy();
    expect(screen.getByTestId('assign-outcome-conflict-client-2')).toBeTruthy();
    expect(screen.getByText('On Base Strength, week 3 of 8')).toBeTruthy();

    const pauseButton = screen.getByTestId('assign-outcome-pause-client-2');
    expect(pauseButton.props.accessibilityLabel).toBe("Pause Arjun's current program");
    const completeButton = screen.getByTestId('assign-outcome-complete-client-2');
    expect(completeButton.props.accessibilityLabel).toBe(
      "Mark Arjun's current program as complete",
    );

    expect(announce).toHaveBeenCalledWith('1 of 2 clients assigned. 1 needs attention.');
  });

  it('omits the "Needs attention" tile and section entirely when every client succeeded — never shown empty', () => {
    submitBulk({
      succeeded: [
        { clientId: 'client-1', assignmentId: 'new-1' },
        { clientId: 'client-2', assignmentId: 'new-2' },
      ],
      conflicted: [],
    });

    expect(screen.getByText('Assigned · 2')).toBeTruthy();
    expect(screen.queryByTestId('assign-outcome-stat-attention')).toBeNull();
    expect(screen.queryByText('Needs attention · 0')).toBeNull();
  });

  it("resolving a conflict via Pause retries that client's assignment and moves it from Needs attention into Assigned", () => {
    mockPauseMutate.mockImplementation((_input: unknown, opts?: { onSuccess?: () => void }) =>
      opts?.onSuccess?.(),
    );
    mockCreateMutate.mockImplementation(
      (_input: unknown, opts?: { onSuccess?: (result: { id: string }) => void }) =>
        opts?.onSuccess?.({ id: 'retried-assignment' }),
    );
    submitBulk({
      succeeded: [],
      conflicted: [
        {
          clientId: 'client-2',
          assignmentId: 'assignment-existing',
          programName: 'Base Strength',
          currentWeek: 3,
          durationWeeks: 8,
        },
      ],
    });

    fireEvent.press(screen.getByTestId('assign-outcome-pause-client-2'));

    expect(mockPauseMutate).toHaveBeenCalledWith(
      { assignmentId: 'assignment-existing' },
      expect.anything(),
    );
    expect(mockCreateMutate).toHaveBeenCalledWith(
      { programId: 'program-1', clientId: 'client-2', startDate: expect.any(String) },
      expect.anything(),
    );
    expect(mockTrackEvent).toHaveBeenCalledWith('program_assigned', {
      client_id: 'client-2',
      program_id: 'program-1',
      week_count: 8,
    });
    expect(screen.queryByTestId('assign-outcome-conflict-client-2')).toBeNull();
    expect(screen.getByTestId('assign-outcome-succeeded-client-2')).toBeTruthy();
  });

  it('resolving via Complete does the same, through assignments.complete', () => {
    mockCompleteMutate.mockImplementation((_input: unknown, opts?: { onSuccess?: () => void }) =>
      opts?.onSuccess?.(),
    );
    mockCreateMutate.mockImplementation(
      (_input: unknown, opts?: { onSuccess?: (result: { id: string }) => void }) =>
        opts?.onSuccess?.({ id: 'retried-assignment' }),
    );
    submitBulk({
      succeeded: [],
      conflicted: [
        {
          clientId: 'client-2',
          assignmentId: 'assignment-existing',
          programName: 'Base Strength',
          currentWeek: 3,
          durationWeeks: 8,
        },
      ],
    });

    fireEvent.press(screen.getByTestId('assign-outcome-complete-client-2'));

    expect(mockCompleteMutate).toHaveBeenCalledWith(
      { assignmentId: 'assignment-existing' },
      expect.anything(),
    );
    expect(screen.getByTestId('assign-outcome-succeeded-client-2')).toBeTruthy();
  });

  it('a genuine resolution failure shows a row-scoped error rather than moving the client anywhere', () => {
    mockPauseMutate.mockImplementation((_input: unknown, opts?: { onError?: () => void }) =>
      opts?.onError?.(),
    );
    submitBulk({
      succeeded: [],
      conflicted: [
        {
          clientId: 'client-2',
          assignmentId: 'assignment-existing',
          programName: 'Base Strength',
          currentWeek: 3,
          durationWeeks: 8,
        },
      ],
    });

    fireEvent.press(screen.getByTestId('assign-outcome-pause-client-2'));

    expect(screen.getByTestId('assign-outcome-row-error')).toBeTruthy();
    expect(screen.getByTestId('assign-outcome-conflict-client-2')).toBeTruthy();
    expect(screen.queryByTestId('assign-outcome-succeeded-client-2')).toBeNull();
  });

  it('"Done" closes the sheet regardless of any remaining conflict', () => {
    const { onDismiss } = submitBulk({
      succeeded: [],
      conflicted: [
        {
          clientId: 'client-2',
          assignmentId: 'assignment-existing',
          programName: 'Base Strength',
          currentWeek: 3,
          durationWeeks: 8,
        },
      ],
    });

    fireEvent.press(screen.getByText('Done'));
    expect(onDismiss).toHaveBeenCalled();
  });
});
