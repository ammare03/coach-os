// The age rules, in one place (`07`) — `CLAUDE.md` §21.5's table turned
// into code. Enforced here, in application code, not a database `CHECK`:
// the constraint depends on `now()`, which a `CHECK` cannot reference
// (`07`'s Approach step 3). `identity.users`'s own `users_minor_is_client`
// and `users_minor_has_guardian` CHECKs enforce the *invariants* this
// module's output must never violate; this file is what computes the
// values those invariants check.
//
// Self-declared, deliberately (`07`'s Approach step 7, `CLAUDE.md` §21.5):
// we ask for a birthdate, we do not verify it against a document.
// Collecting government ID from a teenager to lift weights would be a far
// worse privacy outcome than the risk this trades away.

export const MINIMUM_AGE_YEARS = 13;
export const ADULT_AGE_YEARS = 18;

export type SignupAgeOutcome = 'ok' | 'AGE_BELOW_MINIMUM' | 'COACH_MUST_BE_ADULT';

/**
 * Whole years between `dateOfBirth` (a `YYYY-MM-DD` calendar date, no time
 * component — `primitives.ts`'s `calendarDate`) and `asOf`, correct at the
 * exact day a birthday lands rather than off by one either direction. Pure
 * string/number arithmetic, no `Date` timezone conversion to get wrong —
 * both inputs are calendar dates, compared as calendar dates.
 */
export function computeAgeYears(dateOfBirth: string, asOf: Date = new Date()): number {
  const [birthYear, birthMonth, birthDay] = dateOfBirth.split('-').map(Number);
  if (birthYear === undefined || birthMonth === undefined || birthDay === undefined) {
    throw new RangeError(`not a calendar date: ${dateOfBirth}`);
  }

  const asOfYear = asOf.getUTCFullYear();
  const asOfMonth = asOf.getUTCMonth() + 1;
  const asOfDay = asOf.getUTCDate();

  let age = asOfYear - birthYear;
  const birthdayNotYetReachedThisYear =
    asOfMonth < birthMonth || (asOfMonth === birthMonth && asOfDay < birthDay);
  if (birthdayNotYetReachedThisYear) {
    age -= 1;
  }
  return age;
}

/** 13 through 17 inclusive — the one age band that gets `is_minor = true` at all (`07`'s rules table; under-13 is refused, never stored). */
export function isMinorAge(dateOfBirth: string, asOf: Date = new Date()): boolean {
  const age = computeAgeYears(dateOfBirth, asOf);
  return age >= MINIMUM_AGE_YEARS && age < ADULT_AGE_YEARS;
}

/**
 * `07`'s rules table, for the one signup path that exists today:
 * `auth.signUp` creates coaches only (`02`'s "Why this exists"). The
 * 13-17-client branch of that table has no caller yet — client accounts
 * are created by `../invites/04-invite-acceptance.md`, not this function —
 * so `role` here is deliberately narrower than the table's own two
 * columns; that task calls `isMinorAge` and `computeAgeYears` directly for
 * its own guardian-consent branch instead of this function.
 */
export function evaluateSignupAge(dateOfBirth: string, asOf: Date = new Date()): SignupAgeOutcome {
  const age = computeAgeYears(dateOfBirth, asOf);
  if (age < MINIMUM_AGE_YEARS) {
    return 'AGE_BELOW_MINIMUM';
  }
  if (age < ADULT_AGE_YEARS) {
    return 'COACH_MUST_BE_ADULT';
  }
  return 'ok';
}
