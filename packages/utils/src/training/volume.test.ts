import { countWorkingSets, sessionVolumeKg } from './volume.ts';

describe('sessionVolumeKg', () => {
  it('multiplies reps by weight across the working sets', () => {
    expect(
      sessionVolumeKg([
        { reps: 8, weightKg: 60, isWarmup: false },
        { reps: 8, weightKg: 60, isWarmup: false },
      ]),
    ).toBe(960);
  });

  it('excludes warm-up sets', () => {
    // A heavier warm-up must not make the session look harder.
    expect(
      sessionVolumeKg([
        { reps: 10, weightKg: 20, isWarmup: true },
        { reps: 5, weightKg: 100, isWarmup: false },
      ]),
    ).toBe(500);
  });

  it('returns null rather than 0 when nothing usable was logged', () => {
    // 0 kg reads as "you lifted nothing" (`COPY.md` CO§2). The card omits
    // the metric instead.
    expect(sessionVolumeKg([])).toBeNull();
    expect(sessionVolumeKg([{ reps: 10, weightKg: 20, isWarmup: true }])).toBeNull();
  });

  it('skips a set with no weight recorded rather than counting it as weightless', () => {
    expect(
      sessionVolumeKg([
        { reps: 12, weightKg: null, isWarmup: false },
        { reps: 5, weightKg: 100, isWarmup: false },
      ]),
    ).toBe(500);
  });

  it('returns null when every working set is missing reps or weight', () => {
    expect(
      sessionVolumeKg([
        { reps: null, weightKg: 100, isWarmup: false },
        { reps: 12, weightKg: null, isWarmup: false },
      ]),
    ).toBeNull();
  });

  it('skips a non-finite value rather than poisoning the total with NaN', () => {
    // A corrupted local row must not turn the whole Volume metric into
    // "NaN kg" — the honest answer is the volume of the sets that are sane.
    expect(
      sessionVolumeKg([
        { reps: Number.NaN, weightKg: 60, isWarmup: false },
        { reps: 5, weightKg: Number.POSITIVE_INFINITY, isWarmup: false },
        { reps: 5, weightKg: 100, isWarmup: false },
      ]),
    ).toBe(500);
  });

  it('is in kilograms and does not round', () => {
    expect(sessionVolumeKg([{ reps: 3, weightKg: 62.5, isWarmup: false }])).toBe(187.5);
  });
});

describe('countWorkingSets', () => {
  it('counts only the sets that were not warm-ups', () => {
    expect(countWorkingSets([{ isWarmup: true }, { isWarmup: false }, { isWarmup: false }])).toBe(
      2,
    );
  });

  it('is zero for a session with nothing logged', () => {
    expect(countWorkingSets([])).toBe(0);
  });
});
