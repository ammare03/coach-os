import { formatNumeric, parseNumeric } from './numeric.ts';

describe('parseNumeric', () => {
  it('parses a weight_kg-shaped value (numeric(6,2))', () => {
    expect(parseNumeric('62.50', 2)).toBe(62.5);
  });

  it('parses a calories_per_100g-shaped value (numeric(7,2))', () => {
    expect(parseNumeric('189.34', 2)).toBe(189.34);
  });

  it('parses an rpe-shaped value (numeric(3,1))', () => {
    expect(parseNumeric('8.5', 1)).toBe(8.5);
  });

  it('parses a negative value', () => {
    expect(parseNumeric('-4.25', 2)).toBe(-4.25);
  });

  it('parses an integer-valued numeric with no decimal point', () => {
    expect(parseNumeric('62', 2)).toBe(62);
  });

  it('rounds to the declared scale rather than keeping excess precision', () => {
    // Simulates a value that already drifted through prior arithmetic
    // (DB§11.2's "62.500000001" warning) — the boundary must clamp it.
    expect(parseNumeric('62.5000000001', 2)).toBe(62.5);
  });

  it('handles a value at the edge of a CHECK-constrained range (RPE, 1-10)', () => {
    expect(parseNumeric('10.0', 1)).toBe(10);
  });

  it('rejects a malformed numeric string', () => {
    expect(() => parseNumeric('not-a-number', 2)).toThrow(RangeError);
  });

  it('rejects exponent notation', () => {
    expect(() => parseNumeric('1e5', 2)).toThrow(RangeError);
  });

  it('rejects a leading plus sign', () => {
    expect(() => parseNumeric('+5.00', 2)).toThrow(RangeError);
  });

  it('rejects a non-integer scale', () => {
    expect(() => parseNumeric('62.50', 2.5)).toThrow(RangeError);
  });

  it('rejects a negative scale', () => {
    expect(() => parseNumeric('62.50', -1)).toThrow(RangeError);
  });
});

describe('formatNumeric', () => {
  it('formats a weight_kg-shaped value (numeric(6,2))', () => {
    expect(formatNumeric(62.5, 2)).toBe('62.50');
  });

  it('formats a calories_per_100g-shaped value (numeric(7,2))', () => {
    expect(formatNumeric(189.34, 2)).toBe('189.34');
  });

  it('formats a negative value', () => {
    expect(formatNumeric(-4.25, 2)).toBe('-4.25');
  });

  it('clamps floating-point arithmetic drift to the declared scale', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE 754 double — exactly the
    // drift DB§11.2 warns a naive write would serialise verbatim.
    expect(formatNumeric(0.1 + 0.2, 2)).toBe('0.30');
  });

  it('handles a value at the edge of a CHECK-constrained range (RPE, 1-10)', () => {
    expect(formatNumeric(10, 1)).toBe('10.0');
  });

  it('rejects NaN', () => {
    expect(() => formatNumeric(Number.NaN, 2)).toThrow(RangeError);
  });

  it('rejects Infinity', () => {
    expect(() => formatNumeric(Number.POSITIVE_INFINITY, 2)).toThrow(RangeError);
  });

  it('rejects a non-integer scale', () => {
    expect(() => formatNumeric(62.5, 2.5)).toThrow(RangeError);
  });

  it('rejects a negative scale', () => {
    expect(() => formatNumeric(62.5, -1)).toThrow(RangeError);
  });
});

describe('round trip', () => {
  it('produces no drift: string -> number -> string, for values already at the column scale', () => {
    const cases: Array<{ value: string; scale: number }> = [
      { value: '62.50', scale: 2 },
      { value: '189.34', scale: 2 },
      { value: '8.5', scale: 1 },
      { value: '0.00', scale: 2 },
      { value: '-4.25', scale: 2 },
      { value: '9999.99', scale: 2 }, // numeric(6,2)'s maximum magnitude
    ];

    for (const { value, scale } of cases) {
      expect(formatNumeric(parseNumeric(value, scale), scale)).toBe(value);
    }
  });

  it('produces no further drift on a second round trip (write, read, write again)', () => {
    const original = '62.50';
    const scale = 2;
    const firstWrite = formatNumeric(parseNumeric(original, scale), scale);
    const secondWrite = formatNumeric(parseNumeric(firstWrite, scale), scale);
    expect(secondWrite).toBe(original);
  });
});
