import { ToastProvider } from '@coachos/ui';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { TRPCClientError } from '@trpc/client';
import { AccessibilityInfo } from 'react-native';

import type { CoachClientNote } from '../../api.ts';
import { PRIVACY_LABEL_TEXT } from '../../components/PrivacyLabel.tsx';
import { ClientNotesScreen, firstNameOf } from '../ClientNotesScreen.tsx';

// The four states `ui-conventions` §4 requires, plus the two things this tab
// has that the other six do not: a write, and a destructive action that is
// an UNDO rather than a confirmation.

const CLIENT_ID = '01924f2c-0000-7000-8000-00000000000a';
const NOTE_ID = '01924f2c-0000-7000-8000-00000000002a';

interface MockNotes {
  data: { pages: { items: CoachClientNote[]; nextCursor: string | null }[] } | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: jest.Mock;
  refetch: jest.Mock;
}

let mockNotes: MockNotes;

const mockSetPinned = jest.fn();
const mockHide = jest.fn(() => Promise.resolve());
const mockRestore = jest.fn(() => Promise.resolve());
const mockCommit = jest.fn();
const mockCreateMutate = jest.fn();
const mockUpdateMutate = jest.fn();
let mockCreateFailed = false;

jest.mock('../../api.ts', () => {
  const actual = jest.requireActual('../../api.ts') as Record<string, unknown>;
  return {
    ...actual,
    useClientIdentity: () => ({ data: { name: 'Priya Sharma' } }),
    useClientNotes: () => mockNotes,
    useSetNotePinned: () => ({ mutate: mockSetPinned }),
    useDeleteNote: () => ({ hide: mockHide, restore: mockRestore, commit: mockCommit }),
    useWriteNote: () => ({
      create: {
        mutate: mockCreateMutate,
        reset: jest.fn(),
        isPending: false,
        get isError() {
          return mockCreateFailed;
        },
      },
      update: { mutate: mockUpdateMutate, reset: jest.fn(), isPending: false, isError: false },
    }),
  };
});

function makeNote(overrides: Partial<CoachClientNote> = {}): CoachClientNote {
  const createdAt = new Date('2026-09-02T10:00:00.000Z');
  return {
    noteId: NOTE_ID,
    clientId: CLIENT_ID,
    body: 'Prefers morning sessions.',
    isPinned: false,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function settle(items: CoachClientNote[], overrides: Partial<MockNotes> = {}): void {
  mockNotes = {
    data: { pages: [{ items, nextCursor: null }] },
    isPending: false,
    isError: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: jest.fn(),
    refetch: jest.fn(),
    ...overrides,
  };
}

const onBack = jest.fn();

function renderScreen() {
  return render(
    <ToastProvider>
      <ClientNotesScreen clientId={CLIENT_ID} onBack={onBack} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  onBack.mockClear();
  mockSetPinned.mockClear();
  mockHide.mockClear();
  mockRestore.mockClear();
  mockCommit.mockClear();
  mockCreateMutate.mockClear();
  mockUpdateMutate.mockClear();
  mockCreateFailed = false;
  settle([makeNote()]);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ClientNotesScreen', () => {
  it('labels the surface private above the scroll region, in every state', () => {
    settle([makeNote()]);
    renderScreen();
    expect(screen.getByText(PRIVACY_LABEL_TEXT)).toBeTruthy();
    screen.unmount();

    // The claim is about the surface, not the data — it survives a failed
    // read and an empty one.
    settle([], { isPending: true, data: undefined });
    renderScreen();
    expect(screen.getByText(PRIVACY_LABEL_TEXT)).toBeTruthy();
    screen.unmount();

    settle([], { isError: true, error: new Error('offline'), data: undefined });
    renderScreen();
    expect(screen.getByText(PRIVACY_LABEL_TEXT)).toBeTruthy();
  });

  it('draws a skeleton while the first page is in flight, never a spinner', () => {
    settle([], { isPending: true, data: undefined });
    renderScreen();

    expect(screen.getByLabelText('Loading your notes')).toBeTruthy();
    expect(screen.queryByTestId('client-notes-list')).toBeNull();
  });

  it('says what failed and offers a retry, without claiming the notes are gone', () => {
    const refetch = jest.fn();
    settle([], { isError: true, error: new Error('offline'), data: undefined, refetch });
    renderScreen();

    expect(screen.getByText("We couldn't load your notes")).toBeTruthy();
    expect(
      screen.getByText('Check your connection and try again. Nothing you have written is lost.'),
    ).toBeTruthy();

    fireEvent.press(screen.getByText('Try again'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('sends a wrong client id to not-found, never to forbidden', () => {
    settle([], { isError: true, data: undefined, error: notYourClientError() });
    renderScreen();

    expect(screen.getByTestId('client-notes-not-found')).toBeTruthy();
    fireEvent.press(screen.getByText('Back to clients'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('explains what a note is for when there are none, and adds no second button', () => {
    settle([]);
    renderScreen();

    expect(screen.getByText('No notes yet')).toBeTruthy();
    expect(
      screen.getByText(
        'Anything you want to remember about Priya between sessions — an injury, a preference, something they said.',
      ),
    ).toBeTruthy();
    // `Add a note` is already pinned in the fixed head — exactly one of it.
    expect(screen.getAllByLabelText('Add a note')).toHaveLength(1);
  });

  it('groups pinned notes under an eyebrow that says where a pin sends them', () => {
    settle([makeNote({ isPinned: true }), makeNote({ noteId: 'other', isPinned: false })]);
    renderScreen();

    expect(screen.getByText('PINNED · SHOWN ON OVERVIEW')).toBeTruthy();
    expect(screen.getByText('OTHER NOTES')).toBeTruthy();
  });

  it('announces an optimistic pin, because nothing else tells a screen reader', () => {
    renderScreen();
    fireEvent.press(screen.getByLabelText('Pin this note'));

    expect(mockSetPinned).toHaveBeenCalledWith({
      note: expect.objectContaining({ noteId: NOTE_ID }),
      isPinned: true,
    });
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Pinned. This note now appears on Overview.',
    );
  });

  it('deletes immediately and offers an undo — it does not ask first', () => {
    renderScreen();
    fireEvent.press(screen.getByLabelText('Delete this note'));

    // No dialog, no "Are you sure": the row goes and a five-second window
    // opens (`ui-conventions` §5).
    expect(mockHide).toHaveBeenCalledTimes(1);
    expect(mockCommit).not.toHaveBeenCalled();
    expect(screen.getByText('Note deleted')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Undo'));
    expect(mockRestore).toHaveBeenCalledTimes(1);
    // Nothing was sent, so there is nothing to compensate for.
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('opens the composer from the pinned affordance and writes the trimmed body', () => {
    renderScreen();
    fireEvent.press(screen.getByLabelText('Add a note'));

    fireEvent.changeText(screen.getByTestId('note-composer-input'), '  Hates the rower.  ');
    fireEvent.press(screen.getByText('Add note'));

    expect(mockCreateMutate).toHaveBeenCalledWith('Hates the rower.', expect.anything());
  });

  it('keeps the words in the box when the write fails', () => {
    mockCreateFailed = true;
    renderScreen();
    fireEvent.press(screen.getByLabelText('Add a note'));
    fireEvent.changeText(screen.getByTestId('note-composer-input'), 'Hates the rower.');

    expect(screen.getByText("We couldn't save that note")).toBeTruthy();
    expect(
      screen.getByText('Your words are still here. Try again when you are back online.'),
    ).toBeTruthy();
    expect(screen.getByTestId('note-composer-input').props.value).toBe('Hates the rower.');
  });

  it('swaps the row for the composer rather than growing a second identity', () => {
    renderScreen();
    fireEvent.press(screen.getByLabelText('Edit this note'));

    expect(screen.getByTestId('note-composer-input').props.value).toBe('Prefers morning sessions.');
    expect(screen.queryByLabelText('Edit this note')).toBeNull();
    expect(screen.getByText('Save changes')).toBeTruthy();
  });
});

/** A `TRPCClientError` shaped the way the error formatter sends one over the wire. */
function notYourClientError(): TRPCClientError<never> {
  const error = new TRPCClientError<never>('not found');
  Object.defineProperty(error, 'data', { value: { appCode: 'NOT_YOUR_CLIENT', details: {} } });
  return error;
}

describe('firstNameOf', () => {
  it('addresses the client by first name', () => {
    expect(firstNameOf('Priya Sharma')).toBe('Priya');
  });

  it('never leaves the sentence half-formed while the identity is in flight', () => {
    expect(firstNameOf(undefined)).toBe('this client');
    expect(firstNameOf('   ')).toBe('this client');
  });
});
