import {
  composeSkipNoteLines,
  formatSkipNoteLine,
  formatSubstitutionNoteLine,
  parseSessionClientNotes,
  parseSetNote,
  parseSkipNoteLine,
  parseSubstitutionNoteLine,
} from './session-notes.ts';

describe('formatSkipNoteLine', () => {
  it('lowercases the reason label so the sentence reads as one', () => {
    expect(
      formatSkipNoteLine({
        exerciseName: 'Barbell Squat',
        reasonLabel: 'Equipment unavailable',
        note: null,
      }),
    ).toBe('Skipped: Barbell Squat — equipment unavailable');
  });

  it("appends the client's own words in parentheses", () => {
    expect(
      formatSkipNoteLine({
        exerciseName: 'Barbell Squat',
        reasonLabel: 'Pain or discomfort',
        note: 'left knee',
      }),
    ).toBe('Skipped: Barbell Squat — pain or discomfort (left knee)');
  });
});

describe('composeSkipNoteLines', () => {
  it('joins one line per skip, in the order given', () => {
    expect(
      composeSkipNoteLines([
        { exerciseName: 'Squat', reasonLabel: 'Out of time', note: null },
        { exerciseName: 'Bench Press', reasonLabel: 'Something else', note: 'gym shut' },
      ]),
    ).toBe('Skipped: Squat — out of time\nSkipped: Bench Press — something else (gym shut)');
  });

  it('returns an empty string for no skips, so a caller can concatenate unconditionally', () => {
    expect(composeSkipNoteLines([])).toBe('');
  });
});

describe('parseSkipNoteLine', () => {
  it('round-trips what formatSkipNoteLine wrote', () => {
    const skip = { exerciseName: 'Barbell Squat', reasonLabel: 'pain or discomfort', note: null };

    expect(parseSkipNoteLine(formatSkipNoteLine(skip))).toEqual(skip);
  });

  it('round-trips a skip carrying a note', () => {
    const skip = {
      exerciseName: 'Romanian Deadlift',
      reasonLabel: 'equipment unavailable',
      note: 'no bar free',
    };

    expect(parseSkipNoteLine(formatSkipNoteLine(skip))).toEqual(skip);
  });

  it('keeps an em dash inside the exercise name with the name', () => {
    const line = 'Skipped: Split Squat — Rear Foot Elevated — out of time';

    expect(parseSkipNoteLine(line)).toEqual({
      exerciseName: 'Split Squat — Rear Foot Elevated',
      reasonLabel: 'out of time',
      note: null,
    });
  });

  it('keeps parentheses inside the note with the note', () => {
    expect(parseSkipNoteLine('Skipped: Squat — something else (knee (left) again)')).toEqual({
      exerciseName: 'Squat',
      reasonLabel: 'something else',
      note: 'knee (left) again',
    });
  });

  it('keeps an unclosed bracket with the reason rather than guessing at a note', () => {
    expect(parseSkipNoteLine('Skipped: Squat — something else (unfinished')).toEqual({
      exerciseName: 'Squat',
      reasonLabel: 'something else (unfinished',
      note: null,
    });
  });

  it('reads an empty bracket as no note, never as an empty one', () => {
    expect(parseSkipNoteLine('Skipped: Squat — out of time ()')).toEqual({
      exerciseName: 'Squat',
      reasonLabel: 'out of time',
      note: null,
    });
  });

  it.each([
    ['free text the client typed', 'Felt strong today'],
    ['the prefix with nothing after it', 'Skipped: '],
    ['no reason separator', 'Skipped: Barbell Squat'],
    ['an empty exercise name', 'Skipped:  — out of time'],
    ['an empty reason', 'Skipped: Squat — '],
    ['a different sentence that starts the same way', 'Skipped the warmup today'],
  ])('returns null for %s', (_label, line) => {
    expect(parseSkipNoteLine(line)).toBeNull();
  });
});

describe('parseSubstitutionNoteLine', () => {
  it('round-trips what formatSubstitutionNoteLine wrote', () => {
    expect(
      parseSubstitutionNoteLine(formatSubstitutionNoteLine({ originalName: 'Back Squat' })),
    ).toEqual({ originalName: 'Back Squat' });
  });

  it.each([
    ['free text', 'Felt easy'],
    ['a missing full stop', 'Substituted for Back Squat'],
    ['an empty name', 'Substituted for .'],
    ['a sentence that merely contains the phrase', 'I substituted for Back Squat.'],
  ])('returns null for %s', (_label, line) => {
    expect(parseSubstitutionNoteLine(line)).toBeNull();
  });
});

describe('parseSessionClientNotes', () => {
  it('separates skip lines from the words the client wrote', () => {
    const raw = [
      'Skipped: Barbell Squat — pain or discomfort (left knee)',
      'Skipped: Bench Press — out of time',
      'Shoulder felt fine on everything else.',
    ].join('\n');

    expect(parseSessionClientNotes(raw)).toEqual({
      skips: [
        { exerciseName: 'Barbell Squat', reasonLabel: 'pain or discomfort', note: 'left knee' },
        { exerciseName: 'Bench Press', reasonLabel: 'out of time', note: null },
      ],
      freeText: 'Shoulder felt fine on everything else.',
    });
  });

  it('passes free-text-only notes through verbatim, including interior blank lines', () => {
    const raw = 'Tough session.\n\nBack tomorrow.';

    expect(parseSessionClientNotes(raw)).toEqual({ skips: [], freeText: raw });
  });

  it('reports no free text rather than an empty string when every line was a skip', () => {
    expect(parseSessionClientNotes('Skipped: Squat — out of time')).toEqual({
      skips: [{ exerciseName: 'Squat', reasonLabel: 'out of time', note: null }],
      freeText: null,
    });
  });

  it('keeps a malformed skip-shaped line as the client text it is', () => {
    expect(parseSessionClientNotes('Skipped: Squat')).toEqual({
      skips: [],
      freeText: 'Skipped: Squat',
    });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['whitespace only', '   \n  '],
  ])('reports nothing at all for %s', (_label, raw) => {
    expect(parseSessionClientNotes(raw)).toEqual({ skips: [], freeText: null });
  });
});

describe('parseSetNote', () => {
  it("lifts the substitution line out and leaves the client's own note", () => {
    expect(parseSetNote('Substituted for Back Squat.\nFelt it in the left hip')).toEqual({
      substitutedFor: 'Back Squat',
      freeText: 'Felt it in the left hip',
    });
  });

  it('reports a substitution with no note as no free text', () => {
    expect(parseSetNote('Substituted for Back Squat.')).toEqual({
      substitutedFor: 'Back Squat',
      freeText: null,
    });
  });

  it('passes an ordinary note through untouched', () => {
    expect(parseSetNote('Belt on')).toEqual({ substitutedFor: null, freeText: 'Belt on' });
  });

  it('takes only the first substitution line and leaves any later one as text', () => {
    expect(parseSetNote('Substituted for A.\nSubstituted for B.')).toEqual({
      substitutedFor: 'A',
      freeText: 'Substituted for B.',
    });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['whitespace only', ' \n '],
  ])('reports nothing at all for %s', (_label, raw) => {
    expect(parseSetNote(raw)).toEqual({ substitutedFor: null, freeText: null });
  });
});
