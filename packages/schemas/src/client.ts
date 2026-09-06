// Input schemas for `client.*` (dashboard, today, coach). `dashboard`/
// `today`/`coach` are filled by phase-06-onboarding. `leaveCoach`
// (`account-lifecycle/06`, no input) and `updateHistorySharing`
// (`account-lifecycle/07`) land here ahead of that phase.
import { z } from 'zod';

import {
  calendarDate,
  heightCm,
  historySharingInput,
  MAX_NOTE_TEXT,
  MAX_SHORT_TEXT,
  MAX_TAG_ARRAY,
  strictObject,
} from './primitives.ts';

/** `client.updateHistorySharing` (`07`) — widen or narrow the CURRENT relationship's sharing from settings. */
export const updateHistorySharingInput = historySharingInput;
export type UpdateHistorySharingInput = z.infer<typeof updateHistorySharingInput>;

/**
 * `client_profiles.goal` (`client-onboarding/02`) — the `training_goal`
 * Postgres enum, mirrored here so the client-side capture and the eventual
 * write validate against the same list.
 *
 * Unlike {@link COACH_SPECIALTIES}, this one is a real database enum, so
 * it can only be widened by a migration — the list here must match
 * `packages/db/src/schema/enums.ts` exactly, and a value present in one
 * and not the other is a bug either way round.
 */
export const TRAINING_GOALS = [
  'fat_loss',
  'muscle_gain',
  'performance',
  'health',
  'other',
] as const;

export const trainingGoal = z.enum(TRAINING_GOALS);
export type TrainingGoal = z.infer<typeof trainingGoal>;

/**
 * `client_profiles.experience_level` (`client-onboarding/03`) — the
 * `experience_level` Postgres enum, mirrored on the same terms as
 * {@link TRAINING_GOALS}.
 */
export const EXPERIENCE_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;

export const experienceLevel = z.enum(EXPERIENCE_LEVELS);
export type ExperienceLevel = z.infer<typeof experienceLevel>;

/**
 * `client_profiles.sex_at_birth` (`client-onboarding/03`) — `text` plus a
 * `CHECK`, not an enum (DB§5.1's own choice), so this list mirrors the
 * `client_profiles_sex_at_birth_check` constraint exactly.
 */
export const SEXES_AT_BIRTH = ['male', 'female', 'intersex', 'prefer_not_to_say'] as const;

export const sexAtBirth = z.enum(SEXES_AT_BIRTH);
export type SexAtBirth = z.infer<typeof sexAtBirth>;

/**
 * `client.updateProfile` (`client-onboarding/05`) — the one write the whole
 * client onboarding flow makes, called once at the final step with every
 * field steps 02–04 accumulated in the local draft store.
 *
 * An allowlist, for the same reason `coach.updateProfileInput` is one:
 * `client_profiles` also carries `coach_id`, `status`, `history_shared_from`
 * and the rest of the relationship and sharing state, and a generic partial
 * update over that table is a permission bug waiting for its first careless
 * `.set(input)`.
 *
 * Every field is required except `goalNotes` and `trainingDaysPerWeek`.
 * That is deliberate: this is a flow that always sends the rest, and the
 * two optional ones are genuinely optional to a client. `equipmentAccess`
 * and `dietaryRestrictions` are required arrays — an empty array is how
 * "none" is expressed, never an absent key.
 *
 * `heightCm` is the shared primitive, so the bound this validates against
 * is `client_profiles_height_cm_check` itself (50–260) rather than a second
 * copy of those numbers.
 */
export const updateProfileInput = strictObject({
  goal: trainingGoal,
  goalNotes: z.string().trim().max(MAX_NOTE_TEXT),
  dateOfBirth: calendarDate,
  sexAtBirth,
  heightCm,
  experienceLevel,
  // `client_profiles_training_days_per_week_check` — 0 to 14. Not collected
  // at onboarding; the column and this field exist for the coach-side edit
  // that comes later.
  trainingDaysPerWeek: z.number().int().min(0).max(14).optional(),
  // Free-form by design (`text[]`, no `CHECK`), so what is bounded here is
  // the SIZE, not the vocabulary: a client may type a value neither
  // starter list has, and may not send a thousand of them.
  equipmentAccess: z.array(z.string().trim().min(1).max(MAX_SHORT_TEXT)).max(MAX_TAG_ARRAY),
  dietaryRestrictions: z.array(z.string().trim().min(1).max(MAX_SHORT_TEXT)).max(MAX_TAG_ARRAY),
});
export type UpdateProfileInput = z.infer<typeof updateProfileInput>;
