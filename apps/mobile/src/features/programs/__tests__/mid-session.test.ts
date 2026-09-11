import { firstNameOf, midSessionWarning, MID_SESSION_WHEN } from '../mid-session.ts';

// `session-runtime/09` step 5 — the coach-side half, and the one the task
// calls the dangerous one. A coach who believes they just fixed a client's
// working weight, and did not, makes a worse decision than one who knows.

describe('firstNameOf', () => {
  it('takes the leading token', () => {
    expect(firstNameOf('Priya Nair')).toBe('Priya');
    expect(firstNameOf('Arjun')).toBe('Arjun');
  });

  it('survives the whitespace a real name field produces', () => {
    expect(firstNameOf('  Meera   Rao  ')).toBe('Meera');
  });

  it('never returns an empty label for a blank name', () => {
    // A mononym, a name that is all whitespace, or a row that lost its
    // name: the warning must still name SOMEONE rather than reading
    // "is training this session right now".
    expect(firstNameOf('')).toBe('Your client');
    expect(firstNameOf('   ')).toBe('Your client');
  });
});

describe('midSessionWarning', () => {
  it('is null when nobody is inside the day — this is a warning, not a status line', () => {
    expect(midSessionWarning([])).toBeNull();
  });

  it('names one client', () => {
    expect(midSessionWarning(['Priya Nair'])).toBe(
      `Priya is training this session right now. ${MID_SESSION_WHEN}`,
    );
  });

  it('names two', () => {
    expect(midSessionWarning(['Priya Nair', 'Arjun Kapoor'])).toBe(
      `Priya and Arjun are training this session right now. ${MID_SESSION_WHEN}`,
    );
  });

  it('names the first and counts the rest past two', () => {
    expect(midSessionWarning(['Priya Nair', 'Arjun Kapoor', 'Meera Rao'])).toBe(
      `Priya and 2 others are training this session right now. ${MID_SESSION_WHEN}`,
    );
    expect(midSessionWarning(['Priya Nair', 'Arjun Kapoor', 'Meera Rao', 'Sanjay Iyer'])).toBe(
      `Priya and 3 others are training this session right now. ${MID_SESSION_WHEN}`,
    );
  });

  it('always says WHEN the change lands, not only that it did not', () => {
    // The sentence a coach acts on. Without it the warning reads as a
    // failure, and a coach who thinks the save failed will save again.
    for (const names of [['A'], ['A', 'B'], ['A', 'B', 'C']]) {
      expect(midSessionWarning(names)).toContain(
        'Your changes will apply from their next session.',
      );
    }
  });

  it('never guesses a gender', () => {
    for (const names of [['A'], ['A', 'B'], ['A', 'B', 'C']]) {
      const line = midSessionWarning(names) ?? '';
      expect(line).not.toMatch(/\b(her|his|she|he)\b/i);
    }
  });

  it('carries no exclamation mark and no apology', () => {
    const line = midSessionWarning(['Priya Nair']) ?? '';
    expect(line).not.toContain('!');
    expect(line.toLowerCase()).not.toMatch(/sorry|oops|unfortunately|failed/);
  });
});
