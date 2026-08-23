// Every primitive gets a valid case and an invalid case (CLAUDE.md §18.1);
// every bounded primitive is tested at its boundary and one step beyond it,
// in each direction that actually has a bound. Cross-reference against
// DATABASE.md DB§5 when changing a number here — the comment above each
// primitive in primitives.ts names the exact `CHECK` it mirrors.
import {
  calendarDate,
  clientLocalId,
  durationSeconds,
  email,
  heightCm,
  id,
  paginationCursor,
  rir,
  rpe,
  timezone,
  weightKg,
} from './primitives.ts';

describe('id', () => {
  it('accepts a UUID', () => {
    expect(id.safeParse('018f0a3e-1b5a-7c9e-8f3d-1234567890ab').success).toBe(true);
  });

  it('rejects a non-UUID', () => {
    expect(id.safeParse('not-a-uuid').success).toBe(false);
  });
});

describe('clientLocalId', () => {
  it('accepts a UUID', () => {
    expect(clientLocalId.safeParse('018f0a3e-1b5a-7c9e-8f3d-1234567890ab').success).toBe(true);
  });

  it('rejects a non-UUID', () => {
    expect(clientLocalId.safeParse('not-a-uuid').success).toBe(false);
  });
});

describe('email', () => {
  it('trims and lowercases on parse, matching the citext column', () => {
    expect(email.parse('  Coach@Example.COM  ')).toBe('coach@example.com');
  });

  it('rejects a string with no @', () => {
    expect(email.safeParse('not-an-email')).toMatchObject({ success: false });
  });
});

describe('timezone', () => {
  it('accepts a real IANA identifier', () => {
    expect(timezone.safeParse('Asia/Kolkata').success).toBe(true);
  });

  it('rejects a zone the runtime does not recognise', () => {
    expect(timezone.safeParse('Not/AZone').success).toBe(false);
  });
});

describe('calendarDate', () => {
  it('accepts a real calendar date', () => {
    expect(calendarDate.safeParse('2026-08-21').success).toBe(true);
  });

  it('accepts a leap day in a leap year', () => {
    expect(calendarDate.safeParse('2024-02-29').success).toBe(true);
  });

  it('rejects a day that does not exist in a non-leap year', () => {
    expect(calendarDate.safeParse('2026-02-29').success).toBe(false);
  });

  it('rejects a datetime string — a calendar date has no time component', () => {
    expect(calendarDate.safeParse('2026-08-21T00:00:00Z').success).toBe(false);
  });

  it('cannot be substituted for a timestamp without a compiler error', () => {
    const scheduledDate = calendarDate.parse('2026-08-21');
    // A calendar date and a timestamp are not interchangeable (§17.4,
    // §25.5) — the branded type, not just the runtime check, is what
    // makes this a compile error rather than a bug someone has to notice.
    // @ts-expect-error — an ISO timestamp string is not a CalendarDate.
    const asTimestamp: typeof scheduledDate = '2026-08-21T00:00:00Z';
    // @ts-expect-error — a plain, unbranded string is not a CalendarDate either.
    const asPlainString: typeof scheduledDate = 'anything';
    expect([scheduledDate, asTimestamp, asPlainString]).toBeDefined();
  });
});

describe('weightKg', () => {
  it('parses a numeric string to the same number as the number itself', () => {
    expect(weightKg.parse('72.5')).toBe(weightKg.parse(72.5));
  });

  it('accepts the lower boundary, 0', () => {
    expect(weightKg.safeParse(0).success).toBe(true);
  });

  it('rejects one step below the lower boundary', () => {
    expect(weightKg.safeParse(-0.01).success).toBe(false);
  });

  it('accepts the upper boundary, 9999.99 (numeric(6,2))', () => {
    expect(weightKg.safeParse(9999.99).success).toBe(true);
  });

  it('rejects one step beyond the upper boundary', () => {
    expect(weightKg.safeParse(10000).success).toBe(false);
  });
});

describe('heightCm', () => {
  it('accepts the lower boundary, 50', () => {
    expect(heightCm.safeParse(50).success).toBe(true);
  });

  it('rejects one step below the lower boundary', () => {
    expect(heightCm.safeParse(49.9).success).toBe(false);
  });

  it('accepts the upper boundary, 260', () => {
    expect(heightCm.safeParse(260).success).toBe(true);
  });

  it('rejects one step beyond the upper boundary', () => {
    expect(heightCm.safeParse(260.1).success).toBe(false);
  });
});

describe('durationSeconds', () => {
  it('accepts the lower boundary, 0', () => {
    expect(durationSeconds.safeParse(0).success).toBe(true);
  });

  it('rejects one step below the lower boundary', () => {
    expect(durationSeconds.safeParse(-1).success).toBe(false);
  });

  it('rejects a non-integer — no CHECK bounds it above, but the column is still an integer', () => {
    expect(durationSeconds.safeParse(1.5).success).toBe(false);
  });
});

describe('rpe', () => {
  it('accepts the lower boundary, 1', () => {
    expect(rpe.safeParse(1).success).toBe(true);
  });

  it('rejects one step below the lower boundary', () => {
    expect(rpe.safeParse(0.9).success).toBe(false);
  });

  it('accepts the upper boundary, 10', () => {
    expect(rpe.safeParse(10).success).toBe(true);
  });

  it('rejects one step beyond the upper boundary', () => {
    expect(rpe.safeParse(10.1).success).toBe(false);
  });

  it('accepts one decimal place', () => {
    expect(rpe.safeParse(7.5).success).toBe(true);
  });

  it('rejects a second decimal place — numeric(3,1) has a scale of 1', () => {
    expect(rpe.safeParse(7.55).success).toBe(false);
  });
});

describe('rir', () => {
  it('accepts the lower boundary, 0', () => {
    expect(rir.safeParse(0).success).toBe(true);
  });

  it('rejects one step below the lower boundary', () => {
    expect(rir.safeParse(-1).success).toBe(false);
  });

  it('accepts the upper boundary, 10', () => {
    expect(rir.safeParse(10).success).toBe(true);
  });

  it('rejects one step beyond the upper boundary', () => {
    expect(rir.safeParse(11).success).toBe(false);
  });

  it('rejects a non-integer — RIR is a smallint, not a numeric', () => {
    expect(rir.safeParse(5.5).success).toBe(false);
  });
});

describe('paginationCursor', () => {
  it('accepts an ISO datetime string', () => {
    expect(paginationCursor.safeParse('2026-08-21T00:00:00.000Z').success).toBe(true);
  });

  it('rejects a bare calendar date — a cursor is a timestamp, not a day', () => {
    expect(paginationCursor.safeParse('2026-08-21').success).toBe(false);
  });
});
