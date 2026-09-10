import { estimateSessionMinutes, totalTargetSets } from './session-estimate.ts';

describe('estimateSessionMinutes', () => {
  it('returns null for a session with no prescribed blocks', () => {
    // "No estimate" is a real answer, and the card omits the segment
    // rather than rendering "~— min" (today-card/DESIGN-SPEC.md §3.1).
    expect(estimateSessionMinutes([])).toBeNull();
  });

  it('returns null when every block prescribes zero sets', () => {
    expect(estimateSessionMinutes([{ targetSets: 0, targetRestSeconds: 120 }])).toBeNull();
  });

  it('counts working time plus the prescribed rest', () => {
    // 4 sets x (45s under load + 120s rest) = 660s = 11 min.
    expect(estimateSessionMinutes([{ targetSets: 4, targetRestSeconds: 120 }])).toBe(10);
  });

  it('falls back to a default rest for a block that prescribes none', () => {
    // 4 x (45 + 90) = 540s = 9 min, rounded to 10.
    expect(estimateSessionMinutes([{ targetSets: 4, targetRestSeconds: null }])).toBe(10);
  });

  it('sums across blocks', () => {
    const minutes = estimateSessionMinutes([
      { targetSets: 4, targetRestSeconds: 120 },
      { targetSets: 3, targetRestSeconds: 90 },
      { targetSets: 3, targetRestSeconds: 60 },
    ]);
    // 660 + 405 + 315 = 1380s = 23 min, rounded to 25.
    expect(minutes).toBe(25);
  });

  it('rounds to the nearest five minutes, because it is an estimate', () => {
    const minutes = estimateSessionMinutes([{ targetSets: 5, targetRestSeconds: 100 }]);
    expect(minutes).not.toBeNull();
    expect((minutes ?? 0) % 5).toBe(0);
  });

  it('never rounds a real session down to zero', () => {
    expect(estimateSessionMinutes([{ targetSets: 1, targetRestSeconds: 0 }])).toBe(5);
  });

  it('ignores a negative set count rather than subtracting time', () => {
    expect(estimateSessionMinutes([{ targetSets: -4, targetRestSeconds: 120 }])).toBeNull();
  });
});

describe('totalTargetSets', () => {
  it('sums the prescribed working sets', () => {
    expect(
      totalTargetSets([
        { targetSets: 4, targetRestSeconds: 120 },
        { targetSets: 3, targetRestSeconds: 90 },
      ]),
    ).toBe(7);
  });

  it('is zero for an empty session, not null', () => {
    // The "of 22" in "Set 8 of 22" is a count and always renders; the card
    // decides whether to show the segment.
    expect(totalTargetSets([])).toBe(0);
  });
});
