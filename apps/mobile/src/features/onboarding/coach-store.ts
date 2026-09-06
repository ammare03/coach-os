import { createOnboardingDraftStore } from './draft-store.ts';

/**
 * One exercise on one day of the program drafted at step 3. `exerciseName`
 * is denormalised deliberately: the day card has to render a name while
 * offline, and re-fetching one by id to draw a row the coach just added
 * would be a request per row for something they are looking at.
 */
export type ProgramExerciseDraft = {
  exerciseId: string;
  exerciseName: string;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
};

export type ProgramDayDraft = {
  name: string;
  exercises: readonly ProgramExerciseDraft[];
};

/**
 * The coach flow's four steps (`coach-onboarding/README.md`): business name
 * and specialties, the create-or-import program step, and the first invite.
 * Values only — every one JSON-serializable, nothing derived, nothing
 * server-owned. The screens that fill these belong to `coach-onboarding`;
 * this store only holds what they enter.
 */
export type CoachOnboardingFields = {
  businessName: string;
  specialties: readonly string[];
  programName: string;
  programDays: readonly ProgramDayDraft[];
  /** The program created or imported at step 3, once it exists server-side. */
  programId: string | null;
  inviteEmail: string;
  /**
   * Epoch milliseconds, stamped on the first step transition and read once
   * at completion for `onboarding_completed.duration_s` (§20). A number,
   * not a `Date` — this store round-trips through JSON, and the value is a
   * stopwatch reading rather than a calendar day (`code-conventions` §6
   * governs the latter, not this).
   */
  startedAt: number | null;
};

/**
 * Three days, pre-named, is the shape `coach-onboarding/03` asks for: a
 * program with something in it, drafted in about three minutes, and
 * extensible by P07's real builder without a migration because it writes
 * the same `training.programs` rows. A day left empty is still a valid day.
 */
const initialCoachFields: CoachOnboardingFields = {
  businessName: '',
  specialties: [],
  programName: '',
  programDays: [
    { name: 'Day 1', exercises: [] },
    { name: 'Day 2', exercises: [] },
    { name: 'Day 3', exercises: [] },
  ],
  programId: null,
  inviteEmail: '',
  startedAt: null,
};

export const useCoachOnboardingStore = createOnboardingDraftStore<CoachOnboardingFields>(
  'onboarding-draft-coach',
  initialCoachFields,
);
