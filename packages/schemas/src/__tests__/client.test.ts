import { historyInput, MAX_HISTORY_RANGE_DAYS } from '../client.ts';

describe('historyInput', () => {
  it('accepts a trailing 30-day window', () => {
    expect(historyInput.parse({ from: '2026-07-17', to: '2026-08-15' })).toEqual({
      from: '2026-07-17',
      to: '2026-08-15',
    });
  });

  it('accepts a single day', () => {
    expect(historyInput.parse({ from: '2026-08-15', to: '2026-08-15' })).toBeTruthy();
  });

  it('rejects an inverted range', () => {
    expect(() => historyInput.parse({ from: '2026-08-15', to: '2026-08-14' })).toThrow();
  });

  it(`rejects a range spanning ${MAX_HISTORY_RANGE_DAYS} days or more`, () => {
    expect(() => historyInput.parse({ from: '2026-01-01', to: '2026-12-31' })).toThrow();
  });

  it('rejects a timestamp where a calendar date belongs', () => {
    expect(() =>
      historyInput.parse({ from: '2026-08-15T00:00:00.000Z', to: '2026-08-15' }),
    ).toThrow();
  });

  it('rejects an unknown key rather than silently dropping it', () => {
    expect(() =>
      historyInput.parse({ from: '2026-08-01', to: '2026-08-15', clientId: 'someone-else' }),
    ).toThrow();
  });
});
