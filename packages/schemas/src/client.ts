// Input schemas for `client.*` (dashboard, today, coach). `dashboard`/
// `today`/`coach` are filled by phase-06-onboarding. `leaveCoach`
// (`account-lifecycle/06`, no input) and `updateHistorySharing`
// (`account-lifecycle/07`) land here ahead of that phase.
import { z } from 'zod';

import { historySharingInput } from './primitives.ts';

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
