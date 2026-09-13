import { ToastProvider } from '@coachos/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { TRPCClientError } from '@trpc/client';
import type { ReactElement } from 'react';

import { CoachingSection } from '../CoachingSection.tsx';
import { LEAVE_CONFIRMATION_WORD } from '../LeaveCoachRow.tsx';

// `relationship-controls/02`. One file for both components because they are
// one behaviour: the row is what a client presses, and the section is where
// pressing it lands them. Split, the acceptance criterion "success shows the
// no-coach empty state" would be asserted in neither.
//
// Every assertion below is either the COPY — which `account-lifecycle/06`'s
// transition table makes load-bearing rather than decorative — or the one
// mutation this screen may fire, and how many times.

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

let mockIsConnected = true;
jest.mock('../../../../lib/connectivity/useConnectivity.ts', () => ({
  useConnectivity: () => ({ isConnected: mockIsConnected }),
}));

const mockMutate = jest.fn();
const mockInvalidate = jest.fn();
let mockIsPending = false;

jest.mock('../../../../lib/trpc.ts', () => ({
  api: {
    clientApp: {
      leaveCoach: {
        useMutation: () => ({ mutate: mockMutate, isPending: mockIsPending }),
      },
    },
    useUtils: () => ({ clientApp: { invalidate: mockInvalidate } }),
  },
}));

const COACH = { id: '018f4b1e-0000-7000-8000-0000000000c1', name: 'Arjun Mehta' };

type MutateHandlers = { onSuccess: () => void; onError: (error: unknown) => void };

function renderSection(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

/** Scoped, because "Leave coach" is both the row's label and the dialog's action. */
function openDialog() {
  fireEvent.press(screen.getByTestId('settings-leave-coach'));
  return within(screen.getByTestId('leave-coach-confirm'));
}

function typeTheWord(dialog: ReturnType<typeof openDialog>) {
  fireEvent.changeText(dialog.getByPlaceholderText(LEAVE_CONFIRMATION_WORD), 'LEAVE');
}

function handlersOfCall(index: number): MutateHandlers {
  const call = mockMutate.mock.calls[index] as [undefined, MutateHandlers] | undefined;
  if (!call) throw new Error(`leaveCoach was not called ${index + 1} time(s)`);
  return call[1];
}

beforeEach(() => {
  mockPush.mockClear();
  mockMutate.mockClear();
  mockInvalidate.mockClear();
  mockIsConnected = true;
  mockIsPending = false;
});

describe('CoachingSection — which state a client is in', () => {
  it('draws the section only once the coach is known — never a skeleton row', () => {
    renderSection(<CoachingSection coach={null} isLoading density="client" />);

    // A skeleton that resolves to an empty state is a row that was never
    // there, and on a settings list that reads as something just taken away.
    expect(screen.queryByText('Coaching')).toBeNull();
    expect(screen.queryByTestId('settings-leave-coach')).toBeNull();
  });

  it('renders Leave coach under Coaching for a coached client, naming the coach', () => {
    renderSection(<CoachingSection coach={COACH} density="client" />);

    expect(screen.getByText('Coaching')).toBeTruthy();
    expect(screen.getByText('Leave coach')).toBeTruthy();
    expect(screen.getByText('Your coach is Arjun Mehta')).toBeTruthy();
  });

  it('gives a client with no coach the empty state and exactly one action', () => {
    renderSection(<CoachingSection coach={null} density="client" />);

    expect(screen.getByText("You're not currently working with a coach")).toBeTruthy();
    expect(
      screen.getByText(
        "Everything you've logged is still yours. Enter an invite code to work with a new coach.",
      ),
    ).toBeTruthy();
    // Exactly one: leaving this state is one decision, not a menu.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Enter an invite code' })).toBeTruthy();
    // And no way to leave a coach who is not there.
    expect(screen.queryByTestId('settings-leave-coach')).toBeNull();
  });

  it("sends the empty state's one action to the invite flow", () => {
    renderSection(<CoachingSection coach={null} density="client" />);

    fireEvent.press(screen.getByRole('button', { name: 'Enter an invite code' }));
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});

describe('LeaveCoachRow — the row itself', () => {
  it('acts rather than navigates, so it draws no chevron', () => {
    renderSection(<CoachingSection coach={COACH} density="client" />);

    expect(screen.queryByTestId('list-row-chevron')).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('reads as one item, and says what pressing it opens', () => {
    renderSection(<CoachingSection coach={COACH} density="client" />);

    const row = screen.getByTestId('settings-leave-coach');
    expect(row.props.accessibilityLabel).toBe('Leave coach, Your coach is Arjun Mehta');
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityHint).toBe('Opens a confirmation you must type into');
  });
});

describe('LeaveCoachRow — the confirmation states the transition table', () => {
  it('names the coach in the title, by their full name', () => {
    renderSection(<CoachingSection coach={COACH} density="client" />);

    expect(openDialog().getByText('Leave Arjun Mehta')).toBeTruthy();
  });

  it('states the 30-day window, the immediate losses, and what the client keeps', () => {
    renderSection(<CoachingSection coach={COACH} density="client" />);
    const dialog = openDialog();

    // One Text node, not three — one statement, not three list items.
    const said = String(dialog.getByText(/keeps read-only access/).props.children);

    expect(said).toContain(
      'Arjun keeps read-only access to your sessions, check-ins, videos, comments and messages for 30 days. After that, nothing.',
    );
    expect(said).toContain(
      'They lose access to your meals, measurements and photos straight away.',
    );
    expect(said).toContain(
      'You keep everything, forever. Your place on their client list is freed now.',
    );
  });

  it('asks nothing — it states the consequence and takes the typed word', () => {
    renderSection(<CoachingSection coach={COACH} density="client" />);
    const dialog = openDialog();

    expect(dialog.queryByText(/are you sure/i)).toBeNull();
    expect(dialog.getByText('Type LEAVE to confirm')).toBeTruthy();
  });
});

describe('LeaveCoachRow — leaving', () => {
  it('does nothing until the word is typed, then calls leaveCoach exactly once', () => {
    renderSection(<CoachingSection coach={COACH} density="client" />);
    const dialog = openDialog();

    fireEvent.press(dialog.getByText('Leave coach'));
    expect(mockMutate).not.toHaveBeenCalled();

    typeTheWord(dialog);
    fireEvent.press(dialog.getByText('Leave coach'));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate).toHaveBeenCalledWith(undefined, expect.any(Object));
  });

  it('is inert while the mutation is in flight, so a second tap cannot leave twice', () => {
    mockIsPending = true;
    renderSection(<CoachingSection coach={COACH} density="client" />);
    const dialog = openDialog();

    typeTheWord(dialog);
    fireEvent.press(dialog.getByText('Leave coach'));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('cancels without leaving', () => {
    renderSection(<CoachingSection coach={COACH} density="client" />);
    const dialog = openDialog();

    typeTheWord(dialog);
    fireEvent.press(dialog.getByText('Cancel'));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('on success invalidates the relationship reads and says the coach was told', () => {
    renderSection(<CoachingSection coach={COACH} density="client" />);
    const dialog = openDialog();

    typeTheWord(dialog);
    fireEvent.press(dialog.getByText('Leave coach'));
    act(() => handlersOfCall(0).onSuccess());

    expect(screen.getByText("You've left Arjun Mehta. We've let them know.")).toBeTruthy();
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
    // No action on it: this is not an undo offer, and leaving cannot be undone.
    expect(screen.queryByText('Undo')).toBeNull();
    // The dialog is gone — its title is the thing that was on screen.
    expect(screen.queryByText('Leave Arjun Mehta')).toBeNull();
  });

  it('treats a coach who released first as the same outcome, not an error', () => {
    renderSection(<CoachingSection coach={COACH} density="client" />);
    const dialog = openDialog();

    typeTheWord(dialog);
    fireEvent.press(dialog.getByText('Leave coach'));
    act(() => handlersOfCall(0).onError(clientHasNoCoach()));

    expect(screen.queryByText('Leave Arjun Mehta')).toBeNull();
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
    // Nobody was told anything by us, so we do not claim they were.
    expect(screen.queryByText(/We've let them know/)).toBeNull();
  });

  it('keeps the dialog open and the word typed when the mutation fails', () => {
    renderSection(<CoachingSection coach={COACH} density="client" />);
    const dialog = openDialog();

    typeTheWord(dialog);
    fireEvent.press(dialog.getByText('Leave coach'));
    act(() => handlersOfCall(0).onError(new Error('network')));

    const reopened = within(screen.getByTestId('leave-coach-confirm'));
    expect(reopened.getByText('Leave Arjun Mehta')).toBeTruthy();
    expect(reopened.getByText(/Something went wrong/)).toBeTruthy();
    // Still typed, so retrying is one tap rather than the whole word again.
    fireEvent.press(reopened.getByText('Leave coach'));
    expect(mockMutate).toHaveBeenCalledTimes(2);
  });

  it('does not queue the mutation offline, and says why in the dialog', () => {
    mockIsConnected = false;
    renderSection(<CoachingSection coach={COACH} density="client" />);
    const dialog = openDialog();

    typeTheWord(dialog);
    fireEvent.press(dialog.getByText('Leave coach'));

    // Releasing a seat and starting a clock on somebody else's access must
    // never fire days late against a relationship that has since changed.
    expect(mockMutate).not.toHaveBeenCalled();
    expect(
      within(screen.getByTestId('leave-coach-confirm')).getByText(/needs a connection/),
    ).toBeTruthy();
  });
});

/**
 * A real `TRPCClientError`, not a hand-rolled stand-in: `getErrorCode`
 * narrows on `instanceof` first, so a plain object would take the generic
 * branch and the test would pass for the wrong reason.
 */
function clientHasNoCoach(): unknown {
  const error = new TRPCClientError('CLIENT_HAS_NO_COACH');
  (error as { data?: unknown }).data = { appCode: 'CLIENT_HAS_NO_COACH' };
  return error;
}
