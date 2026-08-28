/** Shared with `SignUpForm`'s own Zod field so the inline error and the
 * conversion below agree on exactly what counts as well-formed. */
export const DATE_OF_BIRTH_PATTERN = /^\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})\s*$/;

/**
 * "DD/MM/YYYY" (spaces around the slashes tolerated, matching the sign-up
 * screen's "DD / MM / YYYY" placeholder) → "YYYY-MM-DD", the shape
 * `@coachos/schemas`' `calendarDate` primitive requires. Returns null for
 * anything that isn't three numeric groups in that shape; real calendar
 * validity (Feb 30, a non-leap Feb 29) is left to `calendarDate` itself
 * when the full sign-up payload is validated before submission — this
 * function only reshapes the string, it doesn't re-implement that check.
 */
export function parseDateOfBirthInput(raw: string): string | null {
  const match = DATE_OF_BIRTH_PATTERN.exec(raw);
  const day = match?.[1];
  const month = match?.[2];
  const year = match?.[3];
  if (day === undefined || month === undefined || year === undefined) {
    return null;
  }
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}
