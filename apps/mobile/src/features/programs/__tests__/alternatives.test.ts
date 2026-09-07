import { programs as programsSchemas } from '@coachos/schemas';

import {
  ALTERNATIVES_LIMIT_HINT,
  ALTERNATIVE_BOUNDS,
  approveActionLabel,
  approvedAccessibilityLabel,
  approvedSummary,
  hasPendingChange,
  toggleAlternative,
  type ApprovedAlternative,
} from '../alternatives.ts';

// What this file holds: the rules a coach FEELS in the approved-swaps sheet
// (`program-builder/05`, frame 1f) — the counting commit label, the ceiling
// that refuses a ninth without trapping them at eight, and the "nothing to
// save" state that keeps the footer inert. Pure, so each is one assertion
// rather than a rendering.
//
// It is deliberately NOT where the integrity of the array is tested. Every
// id in it is checked server-side against `training.exercises`, because the
// column has no foreign key and a patched client is exactly the case that
// matters (`apps/api/src/features/programs/program-exercises.test.ts`).

function approved(...ids: string[]): ApprovedAlternative[] {
  return ids.map((id) => ({ id, name: `Exercise ${id}` }));
}

describe('ALTERNATIVE_BOUNDS', () => {
  it('reads the ceiling from the shared schema rather than restating it', () => {
    expect(ALTERNATIVE_BOUNDS.maxApproved).toBe(programsSchemas.PROGRAM_BOUNDS.maxAlternatives);
  });

  it('prints the same number in the hint the coach reads before hitting it', () => {
    expect(ALTERNATIVES_LIMIT_HINT).toContain(String(ALTERNATIVE_BOUNDS.maxApproved));
  });
});

describe('approveActionLabel', () => {
  it('counts what it is about to approve', () => {
    expect(approveActionLabel(3)).toBe('Approve 3 swaps');
  });

  it('says swap, singular, for one', () => {
    expect(approveActionLabel(1)).toBe('Approve 1 swap');
  });

  it('gives an empty save its own words rather than a zero that reads as broken', () => {
    expect(approveActionLabel(0)).toBe('Save with no swaps');
  });
});

describe('toggleAlternative', () => {
  it('appends in the order the coach picked, not sorted', () => {
    expect(toggleAlternative(['b'], 'a')).toEqual(['b', 'a']);
  });

  it('removes an id already selected', () => {
    expect(toggleAlternative(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('refuses one past the ceiling and returns the list unchanged', () => {
    const full = Array.from({ length: ALTERNATIVE_BOUNDS.maxApproved }, (_, i) => `ex-${i}`);

    const next = toggleAlternative(full, 'one-too-many');

    expect(next).toBe(full);
  });

  it('still lets a coach deselect AT the ceiling — a ceiling must not be a trap', () => {
    const full = Array.from({ length: ALTERNATIVE_BOUNDS.maxApproved }, (_, i) => `ex-${i}`);

    expect(toggleAlternative(full, 'ex-0')).toHaveLength(full.length - 1);
  });
});

describe('hasPendingChange', () => {
  it('is false when the selection is exactly what is saved', () => {
    expect(hasPendingChange(approved('a', 'b'), ['a', 'b'])).toBe(false);
  });

  it('is true when an id is added', () => {
    expect(hasPendingChange(approved('a'), ['a', 'b'])).toBe(true);
  });

  it('is true when an id is removed', () => {
    expect(hasPendingChange(approved('a', 'b'), ['a'])).toBe(true);
  });

  // The order is what the client's swap sheet lists them in, so moving one
  // is a real edit and the commit must not go inert on it.
  it('is true when only the order differs', () => {
    expect(hasPendingChange(approved('a', 'b'), ['b', 'a'])).toBe(true);
  });

  it('is false for an empty list that was already empty', () => {
    expect(hasPendingChange([], [])).toBe(false);
  });
});

describe('approvedSummary', () => {
  it('lists the names in the coach’s own order', () => {
    expect(
      approvedSummary([
        { id: 'a', name: 'Hack Squat' },
        { id: 'b', name: 'Leg Press' },
      ]),
    ).toBe('Hack Squat, Leg Press');
  });

  it('returns null with nothing approved, so the caller picks its own empty words', () => {
    expect(approvedSummary([])).toBeNull();
  });
});

describe('approvedAccessibilityLabel', () => {
  // A comma-joined list is read as one run-on, so the count leads.
  it('leads with the count, then the names', () => {
    expect(
      approvedAccessibilityLabel([
        { id: 'a', name: 'Hack Squat' },
        { id: 'b', name: 'Leg Press' },
      ]),
    ).toBe('2 approved swaps: Hack Squat, Leg Press');
  });

  it('says swap, singular, for one', () => {
    expect(approvedAccessibilityLabel([{ id: 'a', name: 'Hack Squat' }])).toBe(
      '1 approved swap: Hack Squat',
    );
  });

  it('states the empty case rather than announcing an empty list', () => {
    expect(approvedAccessibilityLabel([])).toBe('No approved swaps yet');
  });
});
