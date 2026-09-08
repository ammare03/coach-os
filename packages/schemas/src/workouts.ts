// Input schemas for `workouts.*` (upcoming, get, start, logSet, updateSet,
// complete, skip, history). `phase-09-workout-logger` fills the rest;
// `upcoming` lands early because `phase-08-offline-core/prefetch/01` needs
// it to populate the device's `local_workout_sessions` before the signal
// disappears, and P08 precedes P09 in build order.
import type { z } from 'zod';

import { calendarDate, strictObject } from './primitives.ts';

/**
 * The widest span `workouts.upcoming` will answer. Prefetch asks for two
 * days (today and tomorrow); the extra headroom exists so a later caller
 * can ask for a week without a schema change, while still bounding the
 * query — an unbounded range is a table scan anyone can request.
 */
export const MAX_UPCOMING_RANGE_DAYS = 14;

const MS_PER_DAY = 86_400_000;

/**
 * A client-local calendar range, inclusive at both ends. Both bounds are
 * `date`s and never timestamps: a session's `scheduled_date` is the
 * client's own local calendar day (`code-conventions` §6, `CLAUDE.md`
 * §25.5), so the range that selects one has to be expressed in the same
 * units.
 */
export const upcomingWorkoutsInput = strictObject({
  from: calendarDate,
  to: calendarDate,
})
  .refine((value) => value.to >= value.from, {
    message: 'to must not be earlier than from',
    path: ['to'],
  })
  .refine(
    (value) =>
      // Both sides are already `z.iso.date()`-validated, so `Date.parse`
      // yields UTC midnight for each and the difference is an exact whole
      // number of days — no timezone enters, because neither bound is an
      // instant.
      (Date.parse(value.to) - Date.parse(value.from)) / MS_PER_DAY < MAX_UPCOMING_RANGE_DAYS,
    { message: `the range may not span more than ${MAX_UPCOMING_RANGE_DAYS} days`, path: ['to'] },
  );
export type UpcomingWorkoutsInput = z.infer<typeof upcomingWorkoutsInput>;
