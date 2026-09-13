import { ToastProvider } from '@coachos/ui';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import type * as ReactNative from 'react-native';

import type { CoachClientNote, PinnedNote } from '../api.ts';
import { enterMotion } from '../hooks/useEnterMotion.ts';
import {
  ClientNotesScreen,
  ENTRANCE_WINDOW_MS,
  groupNotes,
  noteEntranceId,
} from '../screens/ClientNotesScreen.tsx';

// UNFORGET **S42** and **S41**, which are the same bug seen twice: a note
// arriving under `Pinned` without the coach watching it get there.
//
//   - S42 — it was already pinned, on a page nobody has read, and the group
//     was silently wrong.
//   - S41 — it was just pinned, and it teleported.
//
// The S41 assertions are deliberately NOT about pixels. A Reanimated shared
// value is not readable from a test renderer, and asserting one would test
// the mock. What matters is the DECISION — which row is authorised to
// animate, and on which commit — because the failure this replaced
// (`entering=` on a recycled FlashList row) is a decision failure: it
// authorises every row, on every scroll.

const CLIENT_ID = '01924f2c-0000-7000-8000-00000000000a';
const PAGE_ONE_ID = '01924f2c-0000-7000-8000-00000000002a';
const PAGE_THREE_ID = '01924f2c-0000-7000-8000-00000000002b';
const THIRD_ID = '01924f2c-0000-7000-8000-00000000002c';

function makeNote(overrides: Partial<CoachClientNote> = {}): CoachClientNote {
  const createdAt = new Date('2026-09-02T10:00:00.000Z');
  return {
    noteId: PAGE_ONE_ID,
    clientId: CLIENT_ID,
    body: 'Prefers morning sessions.',
    isPinned: false,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

/** Overview's projection: four columns, no `isPinned`, no `clientId`. */
function makePinned(overrides: Partial<PinnedNote> = {}): PinnedNote {
  const at = new Date('2026-03-14T10:00:00.000Z');
  return {
    noteId: PAGE_THREE_ID,
    body: 'Right shoulder flares on flat bench.',
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

describe('groupNotes — S42, a pin the pagination has not reached', () => {
  it('groups a pinned note under Pinned before its page has been read', () => {
    const loadedPageOne = [makeNote()];
    const deepPin = makePinned();

    const keys = groupNotes(loadedPageOne, [deepPin], CLIENT_ID).map((item) => item.key);

    // Before the fix this was ['head-other', ...] — the March note was
    // simply absent until page three arrived.
    expect(keys).toEqual([
      'head-pinned',
      `pinned:${PAGE_THREE_ID}`,
      'head-other',
      `other:${PAGE_ONE_ID}`,
    ]);
  });

  it('carries the deep pin through as a real row, pinned and attributed', () => {
    const rows = groupNotes([], [makePinned()], CLIENT_ID);
    const row = rows.find((item) => item.kind === 'note');

    expect(row).toMatchObject({
      kind: 'note',
      note: {
        noteId: PAGE_THREE_ID,
        clientId: CLIENT_ID,
        body: 'Right shoulder flares on flat bench.',
        // `pinnedNotesQuery`'s own WHERE clause, restated as a field.
        isPinned: true,
      },
    });
  });

  it('renders a note present in BOTH sources exactly once', () => {
    const alsoLoaded = makeNote({ noteId: PAGE_THREE_ID, isPinned: true });

    const keys = groupNotes([alsoLoaded], [makePinned()], CLIENT_ID).map((item) => item.key);

    expect(keys).toEqual(['head-pinned', `pinned:${PAGE_THREE_ID}`]);
    expect(keys.filter((key) => key.includes(PAGE_THREE_ID))).toHaveLength(1);
  });

  it('lets a loaded note speak for itself when the two sources disagree', () => {
    // The coach unpinned it: the paginated cache is patched first, and
    // Overview's list has not caught up. The loaded copy wins, so the row
    // does not jump back up for a frame.
    const unpinnedLocally = makeNote({ noteId: PAGE_THREE_ID, isPinned: false });

    const keys = groupNotes([unpinnedLocally], [makePinned()], CLIENT_ID).map((item) => item.key);

    expect(keys).toEqual(['head-other', `other:${PAGE_THREE_ID}`]);
  });

  it('orders the merged pinned group newest-first across both sources', () => {
    const loadedRecent = makeNote({
      noteId: THIRD_ID,
      isPinned: true,
      createdAt: new Date('2026-09-10T10:00:00.000Z'),
    });

    const keys = groupNotes([loadedRecent], [makePinned()], CLIENT_ID)
      .filter((item) => item.kind === 'note')
      .map((item) => item.key);

    expect(keys).toEqual([`pinned:${THIRD_ID}`, `pinned:${PAGE_THREE_ID}`]);
  });

  it('keys every row by its group, so a re-sort is a re-mount and a scroll is not', () => {
    const note = makeNote();
    const other = groupNotes([note], [], CLIENT_ID).find((item) => item.kind === 'note');
    const pinned = groupNotes([{ ...note, isPinned: true }], [], CLIENT_ID).find(
      (item) => item.kind === 'note',
    );

    // Same note, different key — which is what makes React mount a fresh
    // row at the destination. Scrolling never changes a note's group, so a
    // recycled cell reconciles against the same key.
    expect(other?.key).not.toEqual(pinned?.key);
  });
});

describe('noteEntranceId — S41, the second gate on a live ticket', () => {
  const pinnedNow = makeNote({ isPinned: true });
  const ticket = { noteId: PAGE_ONE_ID, isPinned: true };

  it('authorises nothing when no pin has been tapped', () => {
    expect(noteEntranceId(null, [pinnedNow])).toBeNull();
  });

  it('authorises nothing until the regrouping has actually landed', () => {
    // The instant after the tap: the ticket exists, but `onMutate` awaits a
    // cache snapshot, so the list still shows the OLD state. Firing here
    // would cross-fade the row in the group it is leaving.
    const stillUnpinned = [makeNote({ isPinned: false })];

    expect(noteEntranceId(ticket, stillUnpinned)).toBeNull();
  });

  it('authorises exactly the pinned note on the commit it arrives', () => {
    expect(noteEntranceId(ticket, [pinnedNow])).toBe(PAGE_ONE_ID);
  });

  it('authorises nothing for a note the ticket does not name', () => {
    const others = [makeNote({ noteId: THIRD_ID, isPinned: true })];

    expect(noteEntranceId(ticket, others)).toBeNull();
  });

  it('authorises an unpin too — both directions are a re-sort', () => {
    const unpinned = [makeNote({ isPinned: false })];

    expect(noteEntranceId({ noteId: PAGE_ONE_ID, isPinned: false }, unpinned)).toBe(PAGE_ONE_ID);
  });

  it('authorises nothing once the ticket has expired to null', () => {
    // **The recycle guarantee, at this layer.** `useExpiringTicket` is what
    // turns the ticket to null; from here a mounting cell is indistinguishable
    // from any other render with no tap behind it.
    expect(noteEntranceId(null, [pinnedNow])).toBeNull();
  });
});

describe('enterMotion — the Reduce Motion branch', () => {
  it('drops the travel and shortens, rather than removing the change', () => {
    const reduced = enterMotion(true, 300);

    expect(reduced.riseY).toBe(0);
    expect(reduced.durationMs).toBeLessThan(300);
    // Still a real cross-fade — `accessibility` §6 asks for gentler, never
    // for nothing.
    expect(reduced.durationMs).toBeGreaterThan(0);
  });

  it('keeps the travel and the caller-chosen duration otherwise', () => {
    const full = enterMotion(false, 300);

    expect(full.riseY).toBeGreaterThan(0);
    expect(full.durationMs).toBe(300);
  });
});

// ── The screen, with the row instrumented ───────────────────────────────
//
// The one assertion that cannot be made against a pure function: that a
// plain re-render — which is what a scroll is, once FlashList has recycled
// a cell — hands NO row an entrance.

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
let mockPinned: readonly PinnedNote[];
const mockSetPinned = jest.fn();

jest.mock('../api.ts', () => {
  const actual = jest.requireActual('../api.ts') as Record<string, unknown>;
  return {
    ...actual,
    useClientIdentity: () => ({ data: { name: 'Priya Sharma' } }),
    useClientNotes: () => mockNotes,
    useClientPinnedNotes: () => ({ data: mockPinned }),
    useSetNotePinned: () => ({ mutate: mockSetPinned }),
    useDeleteNote: () => ({
      hide: jest.fn(() => Promise.resolve()),
      restore: jest.fn(() => Promise.resolve()),
      commit: jest.fn(),
    }),
    useWriteNote: () => ({
      create: { mutate: jest.fn(), reset: jest.fn(), isPending: false, isError: false },
      update: { mutate: jest.fn(), reset: jest.fn(), isPending: false, isError: false },
    }),
  };
});

/** Every `isEntering` any row was handed, in render order. */
const entrances: { noteId: string; isEntering: boolean }[] = [];

jest.mock('../components/NoteRow.tsx', () => {
  const { Pressable, Text } = jest.requireActual<typeof ReactNative>('react-native');
  return {
    NoteRow: ({
      note,
      isEntering = false,
      onTogglePin,
    }: {
      note: CoachClientNote;
      isEntering?: boolean;
      onTogglePin: (next: boolean) => void;
    }) => {
      entrances.push({ noteId: note.noteId, isEntering });
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`pin ${note.noteId}`}
          onPress={() => {
            onTogglePin(!note.isPinned);
          }}
        >
          <Text>{note.body}</Text>
        </Pressable>
      );
    },
  };
});

function settle(items: CoachClientNote[]): void {
  mockNotes = {
    data: { pages: [{ items, nextCursor: null }] },
    isPending: false,
    isError: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: jest.fn(),
    refetch: jest.fn(),
  };
}

function renderScreen() {
  return render(
    <ToastProvider>
      <ClientNotesScreen clientId={CLIENT_ID} onBack={jest.fn()} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  entrances.length = 0;
  mockSetPinned.mockClear();
  mockPinned = [];
  settle([makeNote()]);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ClientNotesScreen — the entrance expires, never lingers', () => {
  it('hands no row an entrance on first paint', () => {
    renderScreen();

    expect(entrances).not.toHaveLength(0);
    expect(entrances.every((row) => !row.isEntering)).toBe(true);
  });

  it('hands no row an entrance on a plain re-render', () => {
    const view = renderScreen();
    entrances.length = 0;

    // What a recycle looks like from React's side: the same data, rendered
    // again. An `entering=` prop would have fired here for every row.
    view.rerender(
      <ToastProvider>
        <ClientNotesScreen clientId={CLIENT_ID} onBack={jest.fn()} />
      </ToastProvider>,
    );

    expect(entrances.every((row) => !row.isEntering)).toBe(true);
  });

  it('hands the entrance to exactly one row when the pin lands, and to none after the window', () => {
    jest.useFakeTimers();
    try {
      const view = renderScreen();
      fireEvent.press(screen.getByLabelText(`pin ${PAGE_ONE_ID}`));

      // The optimistic patch lands: the note is now pinned.
      entrances.length = 0;
      settle([makeNote({ isPinned: true })]);
      act(() => {
        view.rerender(
          <ToastProvider>
            <ClientNotesScreen clientId={CLIENT_ID} onBack={jest.fn()} />
          </ToastProvider>,
        );
      });

      expect(entrances.filter((row) => row.isEntering)).toEqual([
        { noteId: PAGE_ONE_ID, isEntering: true },
      ]);

      // The window closes. Every render after this — including every cell
      // the recycler mounts for the rest of the session — is silent.
      entrances.length = 0;
      act(() => {
        jest.advanceTimersByTime(ENTRANCE_WINDOW_MS + 1);
      });

      expect(entrances).not.toHaveLength(0);
      expect(entrances.every((row) => !row.isEntering)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('surfaces a deep pin on the tab without asking for a second page', () => {
    mockPinned = [makePinned()];
    renderScreen();

    expect(screen.getByText('Right shoulder flares on flat bench.')).toBeTruthy();
    expect(mockNotes.fetchNextPage).not.toHaveBeenCalled();
  });
});
