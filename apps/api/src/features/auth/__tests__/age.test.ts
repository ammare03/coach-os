import { computeAgeYears, evaluateSignupAge, isMinorAge } from '../age.ts';

describe('computeAgeYears', () => {
  it('counts a birthday that already passed this year', () => {
    expect(computeAgeYears('2000-01-01', new Date('2026-08-27T00:00:00Z'))).toBe(26);
  });

  it('does not count a birthday later this year', () => {
    expect(computeAgeYears('2000-12-31', new Date('2026-08-27T00:00:00Z'))).toBe(25);
  });

  it('turns a year older on the exact birthday', () => {
    expect(computeAgeYears('2008-08-27', new Date('2026-08-27T00:00:00Z'))).toBe(18);
  });

  it('is still the old age the day before the birthday', () => {
    expect(computeAgeYears('2008-08-27', new Date('2026-08-26T00:00:00Z'))).toBe(17);
  });

  it('handles a leap-day birthdate against a non-leap year', () => {
    expect(computeAgeYears('2008-02-29', new Date('2026-03-01T00:00:00Z'))).toBe(18);
    expect(computeAgeYears('2008-02-29', new Date('2026-02-28T00:00:00Z'))).toBe(17);
  });
});

describe('evaluateSignupAge', () => {
  const asOf = new Date('2026-08-27T00:00:00Z');

  it('refuses under 13 with AGE_BELOW_MINIMUM', () => {
    expect(evaluateSignupAge('2015-01-01', asOf)).toBe('AGE_BELOW_MINIMUM');
  });

  it('refuses exactly 12 with AGE_BELOW_MINIMUM', () => {
    expect(evaluateSignupAge('2014-08-28', asOf)).toBe('AGE_BELOW_MINIMUM');
  });

  it('refuses 13-17 with COACH_MUST_BE_ADULT', () => {
    expect(evaluateSignupAge('2011-01-01', asOf)).toBe('COACH_MUST_BE_ADULT');
  });

  it('refuses exactly 17 with COACH_MUST_BE_ADULT', () => {
    expect(evaluateSignupAge('2009-08-28', asOf)).toBe('COACH_MUST_BE_ADULT');
  });

  it('allows exactly 18', () => {
    expect(evaluateSignupAge('2008-08-27', asOf)).toBe('ok');
  });

  it('allows well over 18', () => {
    expect(evaluateSignupAge('1990-01-01', asOf)).toBe('ok');
  });
});

describe('isMinorAge', () => {
  const asOf = new Date('2026-08-27T00:00:00Z');

  it('is false under 13', () => {
    expect(isMinorAge('2015-01-01', asOf)).toBe(false);
  });

  it('is true for 13', () => {
    expect(isMinorAge('2013-01-01', asOf)).toBe(true);
  });

  it('is true for 17', () => {
    expect(isMinorAge('2009-08-28', asOf)).toBe(true);
  });

  it('is false at exactly 18', () => {
    expect(isMinorAge('2008-08-27', asOf)).toBe(false);
  });

  it('is false for an adult', () => {
    expect(isMinorAge('1990-01-01', asOf)).toBe(false);
  });
});
