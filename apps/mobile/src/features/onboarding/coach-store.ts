import { createOnboardingDraftStore } from './draft-store.ts';

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
  /** The program created or imported at step 3, once it exists server-side. */
  programId: string | null;
  inviteEmail: string;
};

const initialCoachFields: CoachOnboardingFields = {
  businessName: '',
  specialties: [],
  programId: null,
  inviteEmail: '',
};

export const useCoachOnboardingStore = createOnboardingDraftStore<CoachOnboardingFields>(
  'onboarding-draft-coach',
  initialCoachFields,
);
