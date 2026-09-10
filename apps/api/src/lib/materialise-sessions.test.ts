// Real Postgres (`testing` skill §4) — `assignment/03`'s own Risks section
// calls this "the single highest-risk task in P07," so this suite is
// deliberately adversarial about the two claims `./materialise-sessions.ts`'s
// header makes: (1) the day-number-to-weekday mapping (decision (a)), and
// (2) that `scheduled_date` computation is PURE CALENDAR ARITHMETIC that
// produces byte-identical output no matter the client's timezone (decision
// (d)) — mirroring `packages/utils/src/dates.test.ts`'s rigor, but proving
// the opposite direction: that a workout_sessions `date` column, unlike a
// `timestamptz`, has no boundary for a timezone to shift.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient, type Transaction } from '@coachos/db';
import { and, eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import {
  calendarDateForProgramDay,
  computeSessionClientLocalId,
  materialiseSessions,
  programDayForCalendarDate,
} from './materialise-sessions.ts';

let pgContainer: StartedTestContainer;
let db: DbClient;

beforeAll(async () => {
  pgContainer = await new GenericContainer('postgres:16')
    .withEnvironment({
      POSTGRES_USER: 'coachos',
      POSTGRES_PASSWORD: 'coachos',
      POSTGRES_DB: 'coachos',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start();

  process.env.DATABASE_URL = `postgres://coachos:coachos@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential

  const migrateScript = path.join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'packages',
    'db',
    'src',
    'migrate.ts',
  );
  execFileSync(process.execPath, ['--experimental-strip-types', migrateScript], {
    env: { ...process.env },
    stdio: 'inherit',
  });

  db = createDbClient({ connectionString: process.env.DATABASE_URL, sslMode: false });
}, 180_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 120_000);

let seq = 0;

async function insertCoach(): Promise<{ profileId: string }> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${seq}@materialise-test.com`,
      passwordHash: 'argon2id$placeholder',
      name: `Coach ${seq}`,
      role: 'coach',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');
  const [profile] = await db.insert(schema.coachProfiles).values({ userId: user.id }).returning();
  if (!profile) throw new Error('seed insert into coach_profiles did not return a row');
  return { profileId: profile.id };
}

async function insertClient(
  coachProfileId: string,
  timezone = 'UTC',
): Promise<{ profileId: string }> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `client-${seq}@materialise-test.com`,
      passwordHash: 'argon2id$placeholder',
      name: `Client ${seq}`,
      role: 'client',
      timezone,
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');
  const [profile] = await db
    .insert(schema.clientProfiles)
    .values({
      userId: user.id,
      coachId: coachProfileId,
      status: 'active',
      activatedAt: new Date(),
    })
    .returning();
  if (!profile) throw new Error('seed insert into client_profiles did not return a row');
  return { profileId: profile.id };
}

interface DaySpec {
  dayNumber: number;
  isRestDay?: boolean;
}

/** Builds a program with the given weeks (each a list of day specs), all inserted directly — this suite tests `materialiseSessions` in isolation from `assignments.create`'s router wiring (`../routers/__tests__/assignments.test.ts` covers that integration). */
async function insertProgram(
  coachProfileId: string,
  weeks: DaySpec[][],
): Promise<{ id: string; dayIdsByWeekAndNumber: Map<string, string> }> {
  const [program] = await db
    .insert(schema.programs)
    .values({
      coachId: coachProfileId,
      name: 'Materialisation fixture',
      durationWeeks: weeks.length,
    })
    .returning({ id: schema.programs.id });
  if (!program) throw new Error('seed insert into programs did not return a row');

  const dayIdsByWeekAndNumber = new Map<string, string>();
  for (const [index, days] of weeks.entries()) {
    const weekNumber = index + 1;
    const [week] = await db
      .insert(schema.programWeeks)
      .values({ programId: program.id, weekNumber })
      .returning({ id: schema.programWeeks.id });
    if (!week) throw new Error('seed insert into program_weeks did not return a row');

    for (const day of days) {
      const [row] = await db
        .insert(schema.programDays)
        .values({
          programWeekId: week.id,
          dayNumber: day.dayNumber,
          name: `Week ${String(weekNumber)} Day ${String(day.dayNumber)}`,
          isRestDay: day.isRestDay ?? false,
        })
        .returning({ id: schema.programDays.id });
      if (!row) throw new Error('seed insert into program_days did not return a row');
      dayIdsByWeekAndNumber.set(`${String(weekNumber)}:${String(day.dayNumber)}`, row.id);
    }
  }
  return { id: program.id, dayIdsByWeekAndNumber };
}

async function insertAssignment(
  programId: string,
  clientId: string,
  coachId: string,
  startDate: string,
): Promise<{ id: string }> {
  const [assignment] = await db
    .insert(schema.assignments)
    .values({ programId, clientId, coachId, startDate })
    .returning({ id: schema.assignments.id });
  if (!assignment) throw new Error('seed insert into assignments did not return a row');
  return { id: assignment.id };
}

async function sessionsForAssignment(assignmentId: string) {
  return db
    .select()
    .from(schema.workoutSessions)
    .where(eq(schema.workoutSessions.assignmentId, assignmentId))
    .orderBy(schema.workoutSessions.scheduledDate);
}

describe('calendarDateForProgramDay (decision (a): weekday-aligned, short first week)', () => {
  it('maps day 1 of week 1 to start_date itself when start_date is a Monday', () => {
    expect(calendarDateForProgramDay('2026-08-10', 1, 1)).toBe('2026-08-10'); // Monday
  });

  it('aligns every day of week 1 to the calendar week when start_date is a Monday', () => {
    expect(calendarDateForProgramDay('2026-08-10', 1, 2)).toBe('2026-08-11');
    expect(calendarDateForProgramDay('2026-08-10', 1, 7)).toBe('2026-08-16');
  });

  it('returns null for a week-1 day that falls before a mid-week start_date', () => {
    // 2026-08-11 is a Tuesday (weekday 2) — day 1 (Monday) already passed.
    expect(calendarDateForProgramDay('2026-08-11', 1, 1)).toBeNull();
  });

  it('still schedules a week-1 day on or after the mid-week start_date', () => {
    expect(calendarDateForProgramDay('2026-08-11', 1, 2)).toBe('2026-08-11'); // the start date itself
    expect(calendarDateForProgramDay('2026-08-11', 1, 6)).toBe('2026-08-15'); // Saturday
  });

  it('runs every day of week 2 onward in full, regardless of start_date', () => {
    // start_date Tuesday 2026-08-11 -> Monday of week 1 is 2026-08-10 -> week 2's Monday is 2026-08-17.
    expect(calendarDateForProgramDay('2026-08-11', 2, 1)).toBe('2026-08-17');
    expect(calendarDateForProgramDay('2026-08-11', 2, 7)).toBe('2026-08-23');
  });

  it('handles a Sunday start_date (weekday 7) — the whole rest of week 1 is in the past', () => {
    expect(calendarDateForProgramDay('2026-08-16', 1, 1)).toBeNull();
    expect(calendarDateForProgramDay('2026-08-16', 1, 6)).toBeNull();
    expect(calendarDateForProgramDay('2026-08-16', 1, 7)).toBe('2026-08-16');
    expect(calendarDateForProgramDay('2026-08-16', 2, 1)).toBe('2026-08-17');
  });

  it('spans a DST transition as pure calendar arithmetic, with no shift', () => {
    // 2026-03-08 is the US spring-forward Sunday. No US-timezone argument
    // exists here at all — that is the point (decision (d)).
    expect(calendarDateForProgramDay('2026-03-02', 1, 1)).toBe('2026-03-02'); // Monday
    expect(calendarDateForProgramDay('2026-03-02', 1, 7)).toBe('2026-03-08'); // the DST Sunday
    expect(calendarDateForProgramDay('2026-03-02', 2, 1)).toBe('2026-03-09'); // the following Monday
  });
});

describe('programDayForCalendarDate (the inverse, for `today-card/01`)', () => {
  it('round-trips every day of the first four weeks, for every start weekday', () => {
    // The property that matters: the pair describes ONE mapping. A second
    // copy of the weekday-alignment rule in `features/workouts/upcoming.ts`
    // is how the Today card would come to disagree with the sessions
    // materialisation actually produced.
    const startDates = [
      '2026-08-10', // Monday
      '2026-08-11', // Tuesday
      '2026-08-13', // Thursday
      '2026-08-16', // Sunday
    ];

    for (const startDate of startDates) {
      for (let weekNumber = 1; weekNumber <= 4; weekNumber += 1) {
        for (let dayNumber = 1; dayNumber <= 7; dayNumber += 1) {
          const date = calendarDateForProgramDay(startDate, weekNumber, dayNumber);
          if (date === null) continue; // the short first week has no date to invert
          expect(programDayForCalendarDate(startDate, date)).toEqual({ weekNumber, dayNumber });
        }
      }
    }
  });

  it("returns null for a date before the program's Monday-of-week-one anchor", () => {
    expect(programDayForCalendarDate('2026-08-10', '2026-08-09')).toBeNull();
  });

  it('returns null inside the short first week, matching the forward direction', () => {
    // start_date Tuesday: Monday of week 1 materialised no session, so
    // asking what Monday "is" has to answer nothing rather than week 1 day 1.
    expect(calendarDateForProgramDay('2026-08-11', 1, 1)).toBeNull();
    expect(programDayForCalendarDate('2026-08-11', '2026-08-10')).toBeNull();
  });

  it("keeps answering past the program's final week — the caller decides what that means", () => {
    // It does not know `duration_weeks`; `upcoming.ts` looks for a matching
    // `program_weeks` row and reports `weekNumber: null` when there is none.
    expect(programDayForCalendarDate('2026-08-10', '2027-08-09')).toEqual({
      weekNumber: 53,
      dayNumber: 1,
    });
  });

  it('spans a DST transition as pure calendar arithmetic, with no shift', () => {
    expect(programDayForCalendarDate('2026-03-02', '2026-03-08')).toEqual({
      weekNumber: 1,
      dayNumber: 7,
    });
    expect(programDayForCalendarDate('2026-03-02', '2026-03-09')).toEqual({
      weekNumber: 2,
      dayNumber: 1,
    });
  });
});

describe('computeSessionClientLocalId (decision (b): deterministic, not null)', () => {
  it('is deterministic: the same inputs always produce the same uuid', () => {
    const a = computeSessionClientLocalId('client-1', 'assignment-1', '2026-08-11');
    const b = computeSessionClientLocalId('client-1', 'assignment-1', '2026-08-11');
    expect(a).toBe(b);
  });

  it('changes if any one of the three inputs changes', () => {
    const base = computeSessionClientLocalId('client-1', 'assignment-1', '2026-08-11');
    expect(computeSessionClientLocalId('client-2', 'assignment-1', '2026-08-11')).not.toBe(base);
    expect(computeSessionClientLocalId('client-1', 'assignment-2', '2026-08-11')).not.toBe(base);
    expect(computeSessionClientLocalId('client-1', 'assignment-1', '2026-08-12')).not.toBe(base);
  });

  it('produces a well-formed uuidv5 (version and variant nibbles set)', () => {
    const id = computeSessionClientLocalId('client-1', 'assignment-1', '2026-08-11');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('materialiseSessions', () => {
  it('writes one scheduled shell session per non-rest day, on the correct client-local weekday-aligned dates, and skips rest days', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId, 'Asia/Kolkata');
    // Week 1: day1 (Mon, before start) excluded by short-first-week; day2
    // (Tue) included at start_date; day4 (Thu) is a REST day, excluded;
    // day6 (Sat) included. Week 2: day1 (Mon) included; day7 (Sun) rest.
    const program = await insertProgram(coach.profileId, [
      [{ dayNumber: 1 }, { dayNumber: 2 }, { dayNumber: 4, isRestDay: true }, { dayNumber: 6 }],
      [{ dayNumber: 1 }, { dayNumber: 7, isRestDay: true }],
    ]);
    const assignment = await insertAssignment(
      program.id,
      client.profileId,
      coach.profileId,
      '2026-08-11', // Tuesday
    );

    const materialised = await db.transaction((tx) => materialiseSessions(tx, assignment.id));

    expect(materialised.map((s) => s.scheduledDate).sort()).toEqual([
      '2026-08-11',
      '2026-08-15',
      '2026-08-17',
    ]);

    const rows = await sessionsForAssignment(assignment.id);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.clientId).toBe(client.profileId);
      expect(row.coachId).toBe(coach.profileId);
      expect(row.assignmentId).toBe(assignment.id);
      expect(row.status).toBe('scheduled');
      // Decision (c): a materialised session is a SHELL. Never a target
      // value, never a snapshot, never a name copied off the program day.
      expect(row.name).toBeNull();
      expect(row.totalVolumeKg).toBeNull();
      expect(row.programSnapshot).toBeNull();
      expect(row.startedAt).toBeNull();
      expect(row.completedAt).toBeNull();
      // Decision (b): deterministic, not null.
      expect(row.clientLocalId).toBe(
        computeSessionClientLocalId(client.profileId, assignment.id, row.scheduledDate),
      );
    }

    const scheduledDates = rows.map((r) => r.scheduledDate).sort();
    expect(scheduledDates).toEqual(['2026-08-11', '2026-08-15', '2026-08-17']);

    // Both rest days genuinely produced no row at all.
    const restDayIds = [
      program.dayIdsByWeekAndNumber.get('1:4'),
      program.dayIdsByWeekAndNumber.get('2:7'),
    ];
    for (const row of rows) expect(restDayIds).not.toContain(row.programDayId);
  });

  it('produces byte-identical scheduled_date output no matter the client timezone (decision (d))', async () => {
    const coach = await insertCoach();
    const program = await insertProgram(coach.profileId, [
      [{ dayNumber: 1 }, { dayNumber: 3 }, { dayNumber: 7 }],
      [{ dayNumber: 1 }],
    ]);

    // A positive-offset half-hour zone, a negative-offset zone observing
    // DST, and one of the most extreme positive offsets on Earth — the
    // same three-flavour matrix `packages/utils/src/dates.test.ts` uses for
    // `toLocalDate`, deliberately, to make the contrast explicit: THAT
    // suite proves an *instant* lands on different local calendar days in
    // different zones; THIS suite proves a *calendar date* (start_date has
    // no instant to convert) does not.
    const zones = ['Asia/Kolkata', 'America/New_York', 'Pacific/Kiritimati'];
    const startDate = '2026-08-11'; // Tuesday

    const resultsByZone = new Map<string, string[]>();
    for (const timezone of zones) {
      const client = await insertClient(coach.profileId, timezone);
      const assignment = await insertAssignment(
        program.id,
        client.profileId,
        coach.profileId,
        startDate,
      );
      const materialised = await db.transaction((tx) => materialiseSessions(tx, assignment.id));
      resultsByZone.set(timezone, materialised.map((s) => s.scheduledDate).sort());
    }

    const expected = ['2026-08-12', '2026-08-16', '2026-08-17'];
    for (const timezone of zones) {
      expect(resultsByZone.get(timezone)).toEqual(expected);
    }
  });

  it('spans a DST transition without shifting any scheduled_date, for a client observing that DST', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId, 'America/New_York');
    const program = await insertProgram(coach.profileId, [
      [{ dayNumber: 1 }, { dayNumber: 7 }], // Monday and the DST Sunday itself
      [{ dayNumber: 1 }], // the following Monday
    ]);
    const assignment = await insertAssignment(
      program.id,
      client.profileId,
      coach.profileId,
      '2026-03-02', // Monday, the week containing the 2026-03-08 spring-forward
    );

    const materialised = await db.transaction((tx) => materialiseSessions(tx, assignment.id));

    expect(materialised.map((s) => s.scheduledDate).sort()).toEqual([
      '2026-03-02',
      '2026-03-08', // the DST day itself — a plain, unshifted calendar date
      '2026-03-09',
    ]);
  });

  it('all sessions materialise in a single transaction: a mid-batch conflict leaves nothing behind', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId, 'UTC');
    const program = await insertProgram(coach.profileId, [[{ dayNumber: 1 }, { dayNumber: 2 }]]);
    const assignment = await insertAssignment(
      program.id,
      client.profileId,
      coach.profileId,
      '2026-08-10',
    );

    // Pre-seed a row that will collide with `sessions_client_day_unique`
    // for day 2 (2026-08-11) once materialisation reaches it — day 1's
    // insert would otherwise succeed on its own.
    const conflictingDayId = program.dayIdsByWeekAndNumber.get('1:2');
    if (!conflictingDayId) throw new Error('fixture day missing');
    await db.insert(schema.workoutSessions).values({
      clientId: client.profileId,
      coachId: coach.profileId,
      programDayId: conflictingDayId,
      scheduledDate: '2026-08-11',
      status: 'scheduled',
    });

    await expect(db.transaction((tx) => materialiseSessions(tx, assignment.id))).rejects.toThrow();

    // Only the pre-seeded row exists — day 1's session was rolled back with
    // the rest of the failed transaction, not left half-written.
    const rows = await sessionsForAssignment(assignment.id);
    expect(rows).toHaveLength(0);
    const allForClient = await db
      .select()
      .from(schema.workoutSessions)
      .where(eq(schema.workoutSessions.clientId, client.profileId));
    expect(allForClient).toHaveLength(1);
  });

  it('running materialisation twice for the same assignment fails loud rather than duplicating (decision (e))', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId, 'UTC');
    const program = await insertProgram(coach.profileId, [[{ dayNumber: 1 }]]);
    const assignment = await insertAssignment(
      program.id,
      client.profileId,
      coach.profileId,
      '2026-08-10',
    );

    await db.transaction((tx) => materialiseSessions(tx, assignment.id));
    await expect(db.transaction((tx) => materialiseSessions(tx, assignment.id))).rejects.toThrow();

    const rows = await sessionsForAssignment(assignment.id);
    expect(rows).toHaveLength(1); // still exactly the first run's row — no duplicate
  });

  it('materialises nothing for an all-rest-day program, without error', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId, 'UTC');
    const program = await insertProgram(coach.profileId, [[{ dayNumber: 1, isRestDay: true }]]);
    const assignment = await insertAssignment(
      program.id,
      client.profileId,
      coach.profileId,
      '2026-08-10',
    );

    const materialised = await db.transaction((tx) => materialiseSessions(tx, assignment.id));
    expect(materialised).toEqual([]);

    const rows = await sessionsForAssignment(assignment.id);
    expect(rows).toHaveLength(0);
  });

  it('throws for an assignment id that does not exist', async () => {
    await expect(
      db.transaction((tx: Transaction) =>
        materialiseSessions(tx, '00000000-0000-0000-0000-000000000000'),
      ),
    ).rejects.toThrow(/no training.assignments row/);
  });

  it("sources coachId from the client's current coach, not a copy fixed at assignment time", async () => {
    const originalCoach = await insertCoach();
    const client = await insertClient(originalCoach.profileId, 'UTC');
    const program = await insertProgram(originalCoach.profileId, [[{ dayNumber: 1 }]]);
    const assignment = await insertAssignment(
      program.id,
      client.profileId,
      originalCoach.profileId,
      '2026-08-10',
    );

    const newCoach = await insertCoach();
    await db
      .update(schema.clientProfiles)
      .set({ coachId: newCoach.profileId })
      .where(eq(schema.clientProfiles.id, client.profileId));

    await db.transaction((tx) => materialiseSessions(tx, assignment.id));

    const [row] = await db
      .select({ coachId: schema.workoutSessions.coachId })
      .from(schema.workoutSessions)
      .where(
        and(
          eq(schema.workoutSessions.assignmentId, assignment.id),
          eq(schema.workoutSessions.clientId, client.profileId),
        ),
      );
    expect(row?.coachId).toBe(newCoach.profileId);
  });
});
