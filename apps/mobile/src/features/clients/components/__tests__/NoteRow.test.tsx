import { fireEvent, render, screen } from '@testing-library/react-native';

import type { CoachClientNote } from '../../api.ts';
import {
  DELETE_HINT,
  DELETE_LABEL,
  EDIT_LABEL,
  NOTE_CARD_MIN_HEIGHT,
  NOTE_ROW_GAP,
  NOTE_ROW_MIN_HEIGHT,
  NoteRow,
  PIN_OFF_HINT,
  PIN_OFF_LABEL,
  PIN_ON_HINT,
  PIN_ON_LABEL,
  describeNote,
  formatNoteMeta,
  formatNoteStamp,
} from '../NoteRow.tsx';

// Four things this row can get wrong in ways a type check cannot see: the
// row's own reported height (FlashList v2 measures rows, so a drifting
// floor is a scroll defect), the pin's spoken state, the date, and which
// control a tap reaches.

const NOTE_ID = '01924f2c-0000-7000-8000-00000000002a';
const NOW = new Date('2026-09-12T09:00:00.000Z');
const TZ = 'UTC';

function makeNote(overrides: Partial<CoachClientNote> = {}): CoachClientNote {
  const createdAt = new Date('2026-09-02T10:00:00.000Z');
  return {
    noteId: NOTE_ID,
    clientId: '01924f2c-0000-7000-8000-00000000000a',
    body: 'Prefers morning sessions.',
    isPinned: false,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

const onTogglePin = jest.fn();
const onEdit = jest.fn();
const onDelete = jest.fn();

function renderRow(note: CoachClientNote = makeNote()) {
  return render(
    <NoteRow note={note} onTogglePin={onTogglePin} onEdit={onEdit} onDelete={onDelete} now={NOW} />,
  );
}

beforeEach(() => {
  onTogglePin.mockClear();
  onEdit.mockClear();
  onDelete.mockClear();
});

describe('NOTE_CARD_MIN_HEIGHT', () => {
  it('is 1 + 13 + 22 + 9 + 32 + 13 + 1, derived from the tokens it is made of', () => {
    expect(NOTE_CARD_MIN_HEIGHT).toBe(91);
    expect(NOTE_ROW_GAP).toBe(9);
    expect(NOTE_ROW_MIN_HEIGHT).toBe(100);
  });

  it('is a floor on the card, never a fixed height', () => {
    renderRow();

    const row = screen.getByTestId(`note-row-${NOTE_ID}`);
    // The card's inner box carries the floor; a `height` anywhere on this
    // row is what clips the body at 200% text (`accessibility` §3).
    const serialized = JSON.stringify(row.props.style ?? {});
    expect(serialized).not.toContain('"height"');
  });
});

describe('formatNoteStamp', () => {
  it('names the weekday inside a week and the date beyond it', () => {
    expect(formatNoteStamp(new Date('2026-09-08T10:00:00.000Z'), NOW, TZ)).toBe('Tuesday');
    expect(formatNoteStamp(new Date('2026-08-21T10:00:00.000Z'), NOW, TZ)).toBe('21 Aug');
  });

  it('adds the year only when the note is not from this one', () => {
    expect(formatNoteStamp(new Date('2025-12-30T10:00:00.000Z'), NOW, TZ)).toBe('30 Dec 2025');
  });
});

describe('formatNoteMeta', () => {
  it('says nothing about an edit that never happened', () => {
    expect(formatNoteMeta(makeNote(), NOW, TZ)).toBe('2 Sep');
  });

  it('names an edit rather than hiding it', () => {
    const note = makeNote({ updatedAt: new Date('2026-09-09T10:00:00.000Z') });
    expect(formatNoteMeta(note, NOW, TZ)).toBe('2 Sep · edited Wednesday');
  });
});

describe('describeNote', () => {
  it('reads as one sentence, not five fragments', () => {
    expect(describeNote(makeNote(), NOW, TZ)).toBe(
      'Prefers morning sessions. Written 2 September.',
    );
  });

  it('tells a screen reader the note was edited', () => {
    const note = makeNote({ updatedAt: new Date('2026-09-09T10:00:00.000Z') });
    expect(describeNote(note, NOW, TZ)).toContain('Edited 9 September.');
  });
});

describe('NoteRow', () => {
  it('offers three controls, each with its own 48×48 target', () => {
    renderRow();

    for (const label of [PIN_OFF_LABEL, EDIT_LABEL, DELETE_LABEL]) {
      const control = screen.getByLabelText(label);
      // 32 box + 8 slop on each side = 48. At a gap of 10 two slops would
      // overlap and the wrong control would fire, which is why the row
      // spaces them 16 apart.
      expect(control.props.hitSlop).toEqual({ top: 8, bottom: 8, left: 8, right: 8 });
    }
  });

  it('says what the pin will do, and where it sends the note', () => {
    renderRow();

    const pin = screen.getByLabelText(PIN_OFF_LABEL);
    expect(pin.props.accessibilityHint).toBe(PIN_OFF_HINT);
    expect(pin.props.accessibilityState?.selected).toBe(false);
  });

  it('flips the label and the selected state once the note is pinned', () => {
    renderRow(makeNote({ isPinned: true }));

    const pin = screen.getByLabelText(PIN_ON_LABEL);
    expect(pin.props.accessibilityHint).toBe(PIN_ON_HINT);
    expect(pin.props.accessibilityState?.selected).toBe(true);
  });

  it('hands up the state it is moving TO, never a toggle', () => {
    renderRow();
    fireEvent.press(screen.getByLabelText(PIN_OFF_LABEL));
    expect(onTogglePin).toHaveBeenCalledWith(true);

    onTogglePin.mockClear();
    screen.unmount();
    renderRow(makeNote({ isPinned: true }));
    fireEvent.press(screen.getByLabelText(PIN_ON_LABEL));
    expect(onTogglePin).toHaveBeenCalledWith(false);
  });

  it('warns that delete is an undo, not a confirmation', () => {
    renderRow();

    expect(screen.getByLabelText(DELETE_LABEL).props.accessibilityHint).toBe(DELETE_HINT);
    fireEvent.press(screen.getByLabelText(DELETE_LABEL));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('opens the editor from its own control', () => {
    renderRow();
    fireEvent.press(screen.getByLabelText(EDIT_LABEL));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('never clamps the body — a note a coach cannot finish reading is useless', () => {
    const body = 'Right shoulder flares on flat bench. Landmine press instead.';
    renderRow(makeNote({ body }));

    expect(screen.getByText(body).props.numberOfLines).toBeUndefined();
  });
});
