import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import {
  clientDetailKeys,
  insertNoteIntoPages,
  removeNoteFromPages,
  removePinnedNote,
  setPinnedInPages,
  upsertPinnedNote,
  useSetNotePinned,
  type ClientOverview,
  type CoachClientNote,
} from '../api.ts';
import { groupNotes } from '../screens/ClientNotesScreen.tsx';

// **`coach-notes/02`'s third acceptance criterion, asserted against real
// TanStack Query.**
//
// Overview's pinned notes arrive inside `client.overview`, not from
// `notes.listForClient` — so "no duplicate query" is an INVALIDATION
// relationship, and invalidation alone is not enough: the `Tabs` navigator
// keeps Overview mounted, so a coach who pins and immediately switches tabs
// would read the old pinned list for one refetch. Both entries are patched
// in `onMutate`; both are invalidated in `onSettled`.
//
// Only the network is faked here. The cache, the rollback, and every flag
// the screen reads are the library's own — a stubbed mutation result would
// pass whether or not either patch happened.

const CLIENT_ID = '01924f2c-0000-7000-8000-00000000000a';
const NOTE_ID = '01924f2c-0000-7000-8000-00000000002a';
const OTHER_NOTE_ID = '01924f2c-0000-7000-8000-00000000002b';

let mockSetPinned: jest.Mock;

jest.mock('../../../lib/trpc.ts', () => ({
  api: {
    useUtils: () => ({
      client: {
        notes: {
          setPinned: { mutate: (input: unknown) => mockSetPinned(input) },
        },
      },
    }),
  },
}));

const CREATED_AT = new Date('2026-09-02T10:00:00.000Z');

function makeNote(overrides: Partial<CoachClientNote> = {}): CoachClientNote {
  return {
    noteId: NOTE_ID,
    clientId: CLIENT_ID,
    body: 'Prefers morning sessions.',
    isPinned: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function makeOverview(pinnedNotes: ClientOverview['pinnedNotes'] = []): ClientOverview {
  return {
    clientId: CLIENT_ID,
    name: 'Priya Sharma',
    status: 'active',
    goal: 'fat_loss',
    avatarAssetId: null,
    coachSince: new Date('2026-03-01T00:00:00.000Z'),
    pausedAt: null,
    archivedAt: null,
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
    pinnedNotes,
  };
}

const notesKey = clientDetailKeys.tab(CLIENT_ID, 'notes');
const overviewKey = clientDetailKeys.tab(CLIENT_ID, 'overview');

function seed(client: QueryClient, note: CoachClientNote, pinned: ClientOverview['pinnedNotes']) {
  client.setQueryData(notesKey, {
    pages: [{ items: [note], nextCursor: null }],
    pageParams: [null],
  });
  client.setQueryData(overviewKey, makeOverview(pinned));
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function buildClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function readNotes(client: QueryClient): CoachClientNote[] {
  const data = client.getQueryData<{ pages: { items: CoachClientNote[] }[] }>(notesKey);
  return data?.pages.flatMap((page) => page.items) ?? [];
}

function readPinned(client: QueryClient): ClientOverview['pinnedNotes'] {
  return client.getQueryData<ClientOverview>(overviewKey)?.pinnedNotes ?? [];
}

beforeEach(() => {
  mockSetPinned = jest.fn(() => Promise.resolve(makeNote({ isPinned: true })));
});

describe('useSetNotePinned', () => {
  it('patches BOTH cache entries before the server answers', async () => {
    const client = buildClient();
    const note = makeNote();
    seed(client, note, []);
    // Never resolves: everything asserted below has to be true without the
    // network, which is what "optimistic and instant" means.
    mockSetPinned = jest.fn(() => new Promise<CoachClientNote>(() => undefined));

    const { result } = renderHook(() => useSetNotePinned(CLIENT_ID), {
      wrapper: wrapperFor(client),
    });
    result.current.mutate({ note, isPinned: true });

    await waitFor(() => {
      expect(readNotes(client)[0]?.isPinned).toBe(true);
    });
    expect(readPinned(client).map((entry) => entry.noteId)).toEqual([NOTE_ID]);
  });

  it('takes the note off Overview the moment it is unpinned', async () => {
    const client = buildClient();
    const note = makeNote({ isPinned: true });
    seed(client, note, [
      { noteId: NOTE_ID, body: note.body, createdAt: CREATED_AT, updatedAt: CREATED_AT },
    ]);
    mockSetPinned = jest.fn(() => new Promise<CoachClientNote>(() => undefined));

    const { result } = renderHook(() => useSetNotePinned(CLIENT_ID), {
      wrapper: wrapperFor(client),
    });
    result.current.mutate({ note, isPinned: false });

    await waitFor(() => {
      expect(readPinned(client)).toHaveLength(0);
    });
    expect(readNotes(client)[0]?.isPinned).toBe(false);
  });

  it('rolls BOTH entries back when the write fails', async () => {
    const client = buildClient();
    const note = makeNote();
    seed(client, note, []);
    mockSetPinned = jest.fn(() => Promise.reject(new Error('offline')));

    const { result } = renderHook(() => useSetNotePinned(CLIENT_ID), {
      wrapper: wrapperFor(client),
    });
    result.current.mutate({ note, isPinned: true });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(readNotes(client)[0]?.isPinned).toBe(false);
    expect(readPinned(client)).toHaveLength(0);
  });

  it('invalidates both keys once the write settles, and no others', async () => {
    const client = buildClient();
    const note = makeNote();
    seed(client, note, []);
    client.setQueryData(clientDetailKeys.tab(CLIENT_ID, 'training'), { pages: [] });

    const { result } = renderHook(() => useSetNotePinned(CLIENT_ID), {
      wrapper: wrapperFor(client),
    });
    result.current.mutate({ note, isPinned: true });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const invalidated = (key: readonly unknown[]) =>
      client.getQueryState(key)?.isInvalidated ?? false;

    expect(invalidated(notesKey)).toBe(true);
    expect(invalidated(overviewKey)).toBe(true);
    // Narrowest key that is now stale, never the world (`code-conventions` §5).
    expect(invalidated(clientDetailKeys.tab(CLIENT_ID, 'training'))).toBe(false);
  });

  it('sends the identifier field the authz registry maps, and an explicit state', async () => {
    const client = buildClient();
    const note = makeNote();
    seed(client, note, []);

    const { result } = renderHook(() => useSetNotePinned(CLIENT_ID), {
      wrapper: wrapperFor(client),
    });
    result.current.mutate({ note, isPinned: true });

    await waitFor(() => {
      expect(mockSetPinned).toHaveBeenCalledTimes(1);
    });
    // `coachNoteId`, never `noteId` — the name `resource-fields.ts` maps to
    // the `coachNote` kind, and a toggle rather than a boolean would land
    // back where it started after a flaky retry.
    expect(mockSetPinned).toHaveBeenCalledWith({ coachNoteId: NOTE_ID, isPinned: true });
  });
});

describe('the cache patches, as pure functions', () => {
  const first = makeNote();
  const second = makeNote({
    noteId: OTHER_NOTE_ID,
    createdAt: new Date('2026-08-21T10:00:00.000Z'),
    updatedAt: new Date('2026-08-21T10:00:00.000Z'),
  });
  const pages = { pages: [{ items: [first, second], nextCursor: null }], pageParams: [null] };

  it('flips one note and leaves the rest of the page alone', () => {
    const next = setPinnedInPages(pages, OTHER_NOTE_ID, true);
    expect(next.pages[0]?.items.map((item) => item.isPinned)).toEqual([false, true]);
  });

  it('puts an undone delete back where the server ordering had it', () => {
    const without = removeNoteFromPages(pages, OTHER_NOTE_ID);
    expect(without.pages[0]?.items).toHaveLength(1);

    const restored = insertNoteIntoPages(without, second);
    expect(restored.pages[0]?.items.map((item) => item.noteId)).toEqual([NOTE_ID, OTHER_NOTE_ID]);
  });

  it('keeps Overview in `updated_at DESC`, the order `pinnedNotesQuery` reads in', () => {
    const withSecond = upsertPinnedNote([], second);
    const withBoth = upsertPinnedNote(withSecond, first);

    expect(withBoth.map((entry) => entry.noteId)).toEqual([NOTE_ID, OTHER_NOTE_ID]);
    expect(removePinnedNote(withBoth, NOTE_ID).map((entry) => entry.noteId)).toEqual([
      OTHER_NOTE_ID,
    ]);
  });

  it('never lets one note appear twice on Overview', () => {
    const once = upsertPinnedNote([], first);
    expect(upsertPinnedNote(once, first)).toHaveLength(1);
  });
});

describe('groupNotes', () => {
  it('puts pinned first under its own eyebrow, then everything else', () => {
    const pinned = makeNote({ isPinned: true });
    const rest = makeNote({ noteId: OTHER_NOTE_ID });

    expect(groupNotes([rest, pinned], [], CLIENT_ID).map((item) => item.key)).toEqual([
      'head-pinned',
      `pinned:${NOTE_ID}`,
      'head-other',
      `other:${OTHER_NOTE_ID}`,
    ]);
  });

  it('draws no empty group heading', () => {
    expect(groupNotes([makeNote()], [], CLIENT_ID).map((item) => item.key)).toEqual([
      'head-other',
      `other:${NOTE_ID}`,
    ]);
    expect(groupNotes([], [], CLIENT_ID)).toEqual([]);
  });

  it('only spaces the second heading when a first group sits above it', () => {
    const grouped = groupNotes([makeNote()], [], CLIENT_ID);
    expect(grouped[0]).toMatchObject({ kind: 'header', spaced: false });
  });
});
