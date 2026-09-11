import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';

import { resetLocalDbForTests } from '../../../../db/client.ts';
import { resetOutboxFlushStateForTests } from '../../../../lib/outbox/flush.ts';
import { resetSkipPersistenceForTests } from '../../hooks/useSkipExercise.ts';
import { useSkippedExercisesStore } from '../../store/skipped-exercises-store.ts';
import {
  FORM_CHECK_ROUTE,
  PROMPT_COPY,
  PostSessionPrompt,
  formCheckParams,
} from '../PostSessionPrompt.tsx';

// `phase-09-workout-logger/session-summary/02`. The four acceptance criteria,
// at the component boundary: two dismissible actions, neither blocking,
// one linking to `record-form-check` with what this screen knows, and one
// opening task 03's capture inline rather than navigating.
//
// **There is no query provider in this file.** Every tRPC hook in this app
// throws without one, so a prompt that renders and reveals here is a prompt
// with no server call on the path — the same proof the two neighbouring
// suites rely on.

jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(),
  getNetworkStateAsync: jest.fn(),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

const sqlite = jest.requireMock('expo-sqlite') as { __reset: () => void };

const SESSION = '0198f2d6-0000-7000-8000-0000000000aa';
const SQUAT = '0198f2d6-0000-7000-8000-0000000000d1';
const RDL = '0198f2d6-0000-7000-8000-0000000000d2';

beforeEach(() => {
  mockPush.mockClear();
  sqlite.__reset();
  resetLocalDbForTests();
  resetOutboxFlushStateForTests();
  resetSkipPersistenceForTests();
  useSkippedExercisesStore.setState({ sessionLocalId: null, skips: new Map() });
});

afterEach(cleanup);

function renderPrompt(exerciseIds: readonly string[] = [SQUAT, RDL]) {
  render(<PostSessionPrompt sessionLocalId={SESSION} exerciseIds={exerciseIds} />);
}

describe('PostSessionPrompt — two offers', () => {
  it('offers a form check and a note, as two separate actions', () => {
    renderPrompt();

    expect(screen.getByLabelText(PROMPT_COPY.formCheck)).toBeTruthy();
    expect(screen.getByLabelText(PROMPT_COPY.note)).toBeTruthy();
    // Two, never one combined action — decision (b).
    expect(screen.getByTestId('summary-prompt-form-check')).toBeTruthy();
    expect(screen.getByTestId('summary-prompt-note')).toBeTruthy();
  });

  it('opens neither by itself', () => {
    renderPrompt();

    expect(screen.queryByTestId('session-note-capture')).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('PostSessionPrompt — dismissal', () => {
  it('clears one offer without touching the other, and asks nothing first', () => {
    renderPrompt();

    fireEvent.press(screen.getByTestId('summary-prompt-form-check-dismiss'));

    expect(screen.queryByTestId('summary-prompt-form-check')).toBeNull();
    expect(screen.getByTestId('summary-prompt-note')).toBeTruthy();
    // No confirmation, no undo toast, no navigation — dismissing costs
    // nothing and says nothing.
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('leaves nothing behind when both are dismissed', () => {
    renderPrompt();

    fireEvent.press(screen.getByTestId('summary-prompt-form-check-dismiss'));
    fireEvent.press(screen.getByTestId('summary-prompt-note-dismiss'));

    // Absent, not empty: the heading goes with the last row.
    expect(screen.queryByTestId('summary-prompt')).toBeNull();
    expect(screen.queryByText(PROMPT_COPY.heading)).toBeNull();
  });
});

describe('PostSessionPrompt — the note', () => {
  it('reveals task 03’s capture inline, with no navigation', () => {
    renderPrompt();

    fireEvent.press(screen.getByTestId('summary-prompt-note'));

    expect(screen.getByTestId('session-note-capture')).toBeTruthy();
    // The fourth acceptance criterion: inline, not a separate full-screen
    // navigation.
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('reveals the whole capture, effort included', () => {
    // Decision (c): both fields are one write behind one Save, so the row
    // opens both or neither.
    renderPrompt();

    fireEvent.press(screen.getByTestId('summary-prompt-note'));

    expect(screen.getByTestId('session-note-input')).toBeTruthy();
    expect(screen.getByTestId('exertion-picker')).toBeTruthy();
  });

  it('consumes its own row and cannot be put back', () => {
    // Decision (d): a one-way reveal, so nothing already chosen can be
    // hidden again.
    renderPrompt();

    fireEvent.press(screen.getByTestId('summary-prompt-note'));

    expect(screen.queryByTestId('summary-prompt-note')).toBeNull();
    expect(screen.queryByTestId('summary-prompt-note-dismiss')).toBeNull();
  });

  it('keeps the open capture when the other offer is dismissed', () => {
    renderPrompt();
    fireEvent.press(screen.getByTestId('summary-prompt-note'));

    fireEvent.press(screen.getByTestId('summary-prompt-form-check-dismiss'));

    expect(screen.getByTestId('session-note-capture')).toBeTruthy();
  });
});

describe('PostSessionPrompt — the form check', () => {
  it('opens the route §9.1 names', () => {
    renderPrompt();

    fireEvent.press(screen.getByTestId('summary-prompt-form-check'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: FORM_CHECK_ROUTE,
      params: { sessionId: SESSION },
    });
  });

  it('names the exercise when the session logged exactly one', () => {
    renderPrompt([SQUAT]);

    fireEvent.press(screen.getByTestId('summary-prompt-form-check'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: FORM_CHECK_ROUTE,
      params: { sessionId: SESSION, exerciseId: SQUAT },
    });
  });
});

describe('formCheckParams', () => {
  it('always carries the session', () => {
    expect(formCheckParams(SESSION, [])).toEqual({ sessionId: SESSION });
  });

  it('carries the exercise only when there is one answer', () => {
    expect(formCheckParams(SESSION, [SQUAT])).toEqual({
      sessionId: SESSION,
      exerciseId: SQUAT,
    });
    // Six logged and this screen has no idea which one the client wants to
    // film — a pre-filled wrong answer is worse than an unanswered question.
    expect(formCheckParams(SESSION, [SQUAT, RDL])).toEqual({ sessionId: SESSION });
  });
});
