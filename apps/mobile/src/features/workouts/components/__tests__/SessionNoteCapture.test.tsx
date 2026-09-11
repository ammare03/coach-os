import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { sql } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../../../db/client.ts';
import { localWorkoutSessions } from '../../../../db/schema/local-training.ts';
import { deserializeOutboxPayload, enqueueMutation } from '../../../../lib/outbox/enqueue.ts';
import { resetOutboxFlushStateForTests } from '../../../../lib/outbox/flush.ts';
import { serialiseSessionPayload } from '../../../../lib/prefetch/sessions.ts';
import type { LocalSessionPayload } from '../../../../lib/prefetch/sessions.ts';
import { resetSkipPersistenceForTests } from '../../hooks/useSkipExercise.ts';
import { resetSwapPersistenceForTests } from '../../hooks/useSwapExercise.ts';
import { UPDATE_NOTES_PROCEDURE } from '../../hooks/useUpdateSessionNotes.ts';
import { useSkippedExercisesStore } from '../../store/skipped-exercises-store.ts';
import { useSubstitutedExercisesStore } from '../../store/substituted-exercises-store.ts';
import { EXERTION_COPY } from '../PerceivedExertionPicker.tsx';
import { NOTE_CAPTURE_COPY , SessionNoteCapture } from '../SessionNoteCapture.tsx';
import { SESSION_NOTE_COPY } from '../SessionNoteField.tsx';

// `phase-09-workout-logger/session-summary/03`, its Verification section
// verbatim: "Complete a session that included one skip and one swap (so
// `client_notes` already has content), open this capture, confirm the
// existing content is visible, add a client note, save, and confirm the
// final `client_notes` value contains both the original lines and the new
// addition, correctly separated."
//
// **There is no query provider in this file, and that is the offline
// proof.** Every tRPC hook in this app throws without one, so a capture that
// saves here is a capture with no server call on the path — the note reaches
// the server through the outbox and nowhere else.

jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(),
  getNetworkStateAsync: jest.fn(),
}));

const sqlite = jest.requireMock('expo-sqlite') as { __reset: () => void };

const SESSION = '0198f2d6-0000-7000-8000-0000000000aa';
const SQUAT = '0198f2d6-0000-7000-8000-0000000000d1';
const LEG_PRESS = '0198f2d6-0000-7000-8000-0000000000d2';

const STARTED_AT = Date.parse('2026-08-15T12:00:00.000Z');
const COMPLETED_AT = Date.parse('2026-08-15T12:48:00.000Z');

const OWN_WORDS = 'Right knee felt tight on the last two sets.';

const PAYLOAD = {
  session: { name: 'Lower body A', exercises: [] },
  exercises: [],
} as unknown as LocalSessionPayload;

/** See `useStartAdHocSession.test.ts` — the outbox's Drizzle table may not be imported here. */
// eslint-disable-next-line local/no-hand-written-row-type -- a snake_case projection of the device-local outbox
interface QueuedMutation {
  id: string;
  procedure: string;
  payload_json: string;
  depends_on: string | null;
}

beforeEach(() => {
  sqlite.__reset();
  resetLocalDbForTests();
  resetOutboxFlushStateForTests();
  resetSkipPersistenceForTests();
  resetSwapPersistenceForTests();
  useSkippedExercisesStore.setState({ sessionLocalId: null, skips: new Map() });
  useSubstitutedExercisesStore.setState({ sessionLocalId: null, substitutions: new Map() });
});

afterEach(cleanup);

async function seedCompletedSession(
  overrides: Partial<typeof localWorkoutSessions.$inferInsert> = {},
) {
  const db = await getLocalDb();
  await db.insert(localWorkoutSessions).values({
    id: SESSION,
    clientLocalId: SESSION,
    serverId: null,
    scheduledDate: '2026-08-15',
    programDayId: null,
    name: 'Lower body A',
    status: 'completed',
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    payloadJson: serialiseSessionPayload(PAYLOAD),
    startOutboxId: null,
    completeOutboxId: null,
    notesOutboxId: null,
    perceivedExertion: null,
    clientNotes: null,
    syncState: 'pending',
    updatedAt: COMPLETED_AT,
    ...overrides,
  });
  return db;
}

/** The Verification scenario's session: one exercise skipped, one swapped. */
function markOneSkipAndOneSwap() {
  useSkippedExercisesStore.getState().openSession(SESSION);
  useSkippedExercisesStore.getState().skip(SESSION, {
    exerciseKey: 'b-2',
    exerciseId: LEG_PRESS,
    exerciseName: 'Leg press',
    reason: 'equipment',
    note: 'machine was taken',
    atMs: COMPLETED_AT,
  });
  useSubstitutedExercisesStore.getState().openSession(SESSION);
  useSubstitutedExercisesStore.getState().substitute(SESSION, {
    exerciseKey: 'b-1',
    originalExerciseId: SQUAT,
    originalName: 'Barbell back squat',
    substituteExerciseId: LEG_PRESS,
    substituteName: 'Leg press',
    atMs: COMPLETED_AT,
  });
}

async function readRows() {
  const db = await getLocalDb();
  const sessions = await db.select().from(localWorkoutSessions);
  const entries = db.all<QueuedMutation>(sql`SELECT * FROM outbox ORDER BY id`);
  return { sessions, entries };
}

function notesPayload(entries: QueuedMutation[]): Record<string, unknown> | undefined {
  const entry = entries.find((row) => row.procedure === UPDATE_NOTES_PROCEDURE);
  if (!entry) return undefined;
  return deserializeOutboxPayload(entry.payload_json) as Record<string, unknown>;
}

function renderCapture() {
  render(<SessionNoteCapture sessionLocalId={SESSION} />);
}

describe('SessionNoteCapture — the existing record', () => {
  it('shows the skip this session took, unprompted', async () => {
    await seedCompletedSession();
    markOneSkipAndOneSwap();

    renderCapture();

    expect(await screen.findByTestId('session-note-prior')).toBeTruthy();
    expect(screen.getByText(/Skipped: Leg press/)).toBeTruthy();
    expect(screen.getByText(SESSION_NOTE_COPY.priorLabel)).toBeTruthy();
  });

  it('keeps the record OUT of the editable field', async () => {
    // The Risks section's bug, at the component boundary: if the record were
    // the input's value, typing could erase it. It is not, and cannot be.
    await seedCompletedSession();
    markOneSkipAndOneSwap();

    renderCapture();

    await screen.findByTestId('session-note-prior');
    expect(screen.getByTestId('session-note-input').props.value).toBe('');
  });

  it('names the skip but not the swap', async () => {
    // `useSwapExercise` decision (a) routes a substitution to
    // `set_logs.notes`, beside the sets it explains. Repeating it here would
    // have the coach read one fact twice.
    await seedCompletedSession();
    markOneSkipAndOneSwap();

    renderCapture();

    await screen.findByTestId('session-note-prior');
    expect(screen.queryByText(/Substituted/)).toBeNull();
  });

  it('renders no record block for a session run exactly as written', async () => {
    await seedCompletedSession();

    renderCapture();

    await screen.findByTestId('session-note-input');
    expect(screen.queryByTestId('session-note-prior')).toBeNull();
  });
});

describe('SessionNoteCapture — saving', () => {
  it('appends the client’s words to the record, never replacing it', async () => {
    await seedCompletedSession();
    markOneSkipAndOneSwap();
    renderCapture();
    await screen.findByTestId('session-note-prior');

    fireEvent.changeText(screen.getByTestId('session-note-input'), OWN_WORDS);
    fireEvent.press(screen.getByTestId('session-note-save'));

    await waitFor(() => {
      expect(screen.getByText(NOTE_CAPTURE_COPY.saved)).toBeTruthy();
    });

    const { sessions, entries } = await readRows();
    const stored = sessions[0]?.clientNotes ?? '';
    expect(stored).toContain('Skipped: Leg press');
    expect(stored).toContain('machine was taken');
    expect(stored).toContain(OWN_WORDS);
    // The record first, the client's words after a blank line.
    expect(stored.indexOf('Skipped: Leg press')).toBeLessThan(stored.indexOf(OWN_WORDS));
    expect(stored).toContain('\n\n');
    expect(notesPayload(entries)?.clientNotes).toBe(stored);
  });

  it('carries the chosen exertion with it', async () => {
    await seedCompletedSession();
    renderCapture();
    await screen.findByTestId('session-note-input');

    fireEvent.press(screen.getByTestId('exertion-7'));
    fireEvent.press(screen.getByTestId('session-note-save'));

    await waitFor(() => {
      expect(screen.getByText(NOTE_CAPTURE_COPY.saved)).toBeTruthy();
    });

    const { sessions, entries } = await readRows();
    expect(sessions[0]?.perceivedExertion).toBe(7);
    expect(notesPayload(entries)?.perceivedExertion).toBe(7);
  });

  it('chains the update behind the session’s completion', async () => {
    const completion = await enqueueMutation({
      procedure: 'workouts.complete',
      payload: { sessionClientLocalId: SESSION, completedAt: new Date(COMPLETED_AT) },
    });
    await seedCompletedSession({ completeOutboxId: completion.outboxId });
    renderCapture();
    await screen.findByTestId('session-note-input');

    fireEvent.changeText(screen.getByTestId('session-note-input'), OWN_WORDS);
    fireEvent.press(screen.getByTestId('session-note-save'));

    await waitFor(() => {
      expect(screen.getByText(NOTE_CAPTURE_COPY.saved)).toBeTruthy();
    });

    const { entries } = await readRows();
    const update = entries.find((entry) => entry.procedure === UPDATE_NOTES_PROCEDURE);
    expect(update?.depends_on).toBe(completion.outboxId);
  });

  it('is inert until something changes, and again once saved', async () => {
    await seedCompletedSession();
    renderCapture();
    await screen.findByTestId('session-note-input');

    expect(screen.getByRole('button', { name: NOTE_CAPTURE_COPY.save })).toBeDisabled();

    fireEvent.changeText(screen.getByTestId('session-note-input'), OWN_WORDS);
    expect(screen.getByRole('button', { name: NOTE_CAPTURE_COPY.save })).not.toBeDisabled();

    fireEvent.press(screen.getByTestId('session-note-save'));
    await waitFor(() => {
      expect(screen.getByText(NOTE_CAPTURE_COPY.saved)).toBeTruthy();
    });
    // The button is replaced by the confirmation, not merely disabled — a
    // saved note has nothing left to offer.
    expect(screen.queryByTestId('session-note-save')).toBeNull();
  });

  it('re-opens with what was saved, and with the record still out of the field', async () => {
    // The second visit — a client who tapped Done, came back from Today, and
    // finds their own words where they left them. The record is NOT in the
    // field on this pass either, so a second save cannot repeat it.
    const skipLine = 'Skipped: Leg press — equipment unavailable (machine was taken)';
    await seedCompletedSession({
      perceivedExertion: 9,
      clientNotes: `${skipLine}

${OWN_WORDS}`,
    });
    markOneSkipAndOneSwap();

    renderCapture();

    await waitFor(() => {
      expect(screen.getByTestId('session-note-input').props.value).toBe(OWN_WORDS);
    });
    expect(screen.getByTestId('exertion-9').props.accessibilityState.checked).toBe(true);
    expect(screen.getByText(new RegExp(skipLine.slice(0, 20)))).toBeTruthy();
    // And offers nothing to save, because nothing has changed.
    expect(screen.getByRole('button', { name: NOTE_CAPTURE_COPY.save })).toBeDisabled();
  });

  it('saves again over an already-saved note without repeating the record', async () => {
    const skipLine = 'Skipped: Leg press — equipment unavailable (machine was taken)';
    await seedCompletedSession({
      clientNotes: `${skipLine}

first thoughts`,
    });
    markOneSkipAndOneSwap();
    renderCapture();
    await waitFor(() => {
      expect(screen.getByTestId('session-note-input').props.value).toBe('first thoughts');
    });

    fireEvent.changeText(screen.getByTestId('session-note-input'), 'second thoughts');
    fireEvent.press(screen.getByTestId('session-note-save'));

    await waitFor(() => {
      expect(screen.getByText(NOTE_CAPTURE_COPY.saved)).toBeTruthy();
    });
    const { sessions } = await readRows();
    const stored = sessions[0]?.clientNotes ?? '';
    expect(stored.match(/Skipped: Leg press/g)).toHaveLength(1);
    expect(stored).toContain('second thoughts');
    expect(stored).not.toContain('first thoughts');
  });
});

describe('PerceivedExertionPicker', () => {
  it('offers ten values, each named with its scale', async () => {
    await seedCompletedSession();
    renderCapture();
    await screen.findByTestId('session-note-input');

    expect(screen.getByLabelText(EXERTION_COPY.option(1, 10))).toBeTruthy();
    expect(screen.getByLabelText(EXERTION_COPY.option(10, 10))).toBeTruthy();
    expect(screen.queryByTestId('exertion-11')).toBeNull();
  });

  it('clears the answer when the chosen number is tapped again', async () => {
    // The field is optional, so unsaying has to cost what saying cost.
    await seedCompletedSession();
    renderCapture();
    await screen.findByTestId('session-note-input');

    fireEvent.press(screen.getByTestId('exertion-4'));
    expect(screen.getByTestId('exertion-4').props.accessibilityState.checked).toBe(true);

    fireEvent.press(screen.getByTestId('exertion-4'));
    expect(screen.getByTestId('exertion-4').props.accessibilityState.checked).toBe(false);
  });

  it('holds exactly one answer at a time', async () => {
    await seedCompletedSession();
    renderCapture();
    await screen.findByTestId('session-note-input');

    fireEvent.press(screen.getByTestId('exertion-4'));
    fireEvent.press(screen.getByTestId('exertion-8'));

    expect(screen.getByTestId('exertion-4').props.accessibilityState.checked).toBe(false);
    expect(screen.getByTestId('exertion-8').props.accessibilityState.checked).toBe(true);
  });
});
