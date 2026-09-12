// Input schemas for `coach.*`, including its `clients` and `notes`
// sub-routers. `clients.list`/`get`/`invite`/`archive` and `notes.*` are
// filled by phase-06-onboarding (clients) and phase-10-coach-review-
// surfaces (dashboard, notes). `clients.release` (`account-lifecycle/06`)
// is the one procedure this module fills ahead of those phases.
import { z } from 'zod';

import { id, MAX_SHORT_TEXT, MAX_TAG_ARRAY, strictObject } from './primitives.ts';

/** `coach.clients.release` (`06`) — ends the relationship from the coach's side. */
export const releaseClientInput = strictObject({
  clientId: id,
});
export type ReleaseClientInput = z.infer<typeof releaseClientInput>;

/**
 * `coach.clients.overview` (`client-detail/01`) — §8.3's Overview tab, in
 * one call. `clientId` and nothing else: every window the response covers
 * (6 months of weight, 8 weeks of adherence) is a product decision that
 * belongs server-side, not a range the caller may widen.
 */
export const clientOverviewInput = strictObject({
  clientId: id,
});
export type ClientOverviewInput = z.infer<typeof clientOverviewInput>;

/**
 * `coach_profiles.specialties` is an unconstrained `text[]` (DB§5.2 adds no
 * `CHECK`), so this list — not the database — is what keeps the column
 * groupable. A free-text field fills it with "fat loss", "weight loss" and
 * "fatloss", and no later feature can tell that those are one thing.
 *
 * Slugs, not labels: the label is a display decision that belongs to the
 * screen (`apps/mobile/.../steps/CoachProfileStep.tsx`), and a stored
 * "Pre & post-natal" would make renaming it a data migration.
 *
 * **Widening this list is additive and safe; narrowing it is not** — a
 * removed value still sits in rows and would fail this schema on the next
 * profile edit. Add, don't replace.
 */
export const COACH_SPECIALTIES = [
  'strength',
  'hypertrophy',
  'fat-loss',
  'powerlifting',
  'bodybuilding',
  'general-fitness',
  'mobility',
  'sport-specific',
  'endurance',
  'pre-post-natal',
] as const;

export const coachSpecialty = z.enum(COACH_SPECIALTIES);
export type CoachSpecialty = z.infer<typeof coachSpecialty>;

/**
 * `coach.updateProfile` (`coach-onboarding/02`) — the business name and
 * specialties captured at onboarding step 2, and the only two
 * `coach_profiles` columns this procedure may touch.
 *
 * An allowlist for the same reason `me.update`'s is one: `coach_profiles`
 * carries `subscription_tier`, `seat_packs`, `entitlement_expires_at` and
 * the rest of §15.7's billing state, and a generic partial-update schema
 * over that table is an entitlement-escalation bug waiting for its first
 * careless `.set(input)`.
 *
 * Both fields are required rather than optional: this is a step in a flow
 * that always sends both, and an empty `specialties` array is how "none"
 * is expressed — never an absent key.
 */
export const updateProfileInput = strictObject({
  businessName: z.string().trim().min(1).max(MAX_SHORT_TEXT),
  // `.max(MAX_TAG_ARRAY)` is headroom over the ten values above, not a
  // target — it is what stands between the procedure and an unbounded
  // array, and it survives the list being widened.
  specialties: z.array(coachSpecialty).max(MAX_TAG_ARRAY),
});
export type UpdateProfileInput = z.infer<typeof updateProfileInput>;

/**
 * The opaque keyset cursor `coach.clients.trainingHistory` hands back.
 * Bounded generously: it encodes a `yyyy-MM-dd` plus a uuid.
 */
const MAX_CURSOR = 128;

// `./limits.ts` owns `MAX_PAGE_SIZE`/`DEFAULT_PAGE_SIZE` for every list
// procedure that takes the package-root `paginationInput`. This module
// cannot import it — `__tests__/layout.test.ts` restricts a router schema
// module to `zod` and `./primitives.ts` — and `trainingHistory` cannot take
// `paginationInput` anyway, because its cursor is a
// `(scheduled_date, id)` keyset rather than `primitives.paginationCursor`'s
// timestamp: `workout_sessions.scheduled_date` is a `date` (the client's
// local training day, DB§5.3), and two sessions can share one. Same numbers
// as `./limits.ts`, restated exactly as `exercises.ts` restates them; keep
// them in step by hand.
const MAX_HISTORY_PAGE_SIZE = 100;
const DEFAULT_HISTORY_PAGE_SIZE = 30;

/**
 * A cursor this API issued, and nothing a caller can usefully assemble —
 * the same base64url alphabet guard `exercises.list` uses, for the same
 * reason: a cursor the client builds is a cursor the server has to trust.
 */
const trainingHistoryCursor = z
  .string()
  .max(MAX_CURSOR)
  .regex(/^[A-Za-z0-9_-]+$/, 'cursor is not a value this API issued');

/**
 * `coach.clients.trainingHistory` (`client-detail/02`) — §8.3's session
 * history list, most recent first.
 *
 * No date range and no status filter: the window a coach sees is a product
 * decision that belongs server-side, and the list is keyset-paginated so a
 * client with a year of history never needs one.
 */
export const clientTrainingHistoryInput = strictObject({
  clientId: id,
  cursor: trainingHistoryCursor.optional(),
  limit: z.number().int().min(1).max(MAX_HISTORY_PAGE_SIZE).default(DEFAULT_HISTORY_PAGE_SIZE),
});
export type ClientTrainingHistoryInput = z.infer<typeof clientTrainingHistoryInput>;
