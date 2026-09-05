import { createOnboardingDraftStore } from './draft-store.ts';

/**
 * The client flow's five steps (`client-onboarding/README.md`): goals,
 * measurements, equipment and diet, then the notification permission. Height
 * carries its unit in the name and is stored in centimetres — the metric
 * `client_profiles.height_cm` value, never a converted display number
 * (`code-conventions` §2).
 */
export type ClientOnboardingFields = {
  goal: string;
  goalNotes: string;
  /** ISO `yyyy-MM-dd`, a local calendar date rather than a timestamp (`code-conventions` §6). */
  dateOfBirth: string;
  sexAtBirth: string;
  heightCm: number | null;
  experienceLevel: string;
  equipmentAccess: readonly string[];
  dietaryRestrictions: readonly string[];
  /** Whether the rationale screen has already asked, so a resumed flow doesn't ask twice. */
  notificationPermissionAsked: boolean;
};

const initialClientFields: ClientOnboardingFields = {
  goal: '',
  goalNotes: '',
  dateOfBirth: '',
  sexAtBirth: '',
  heightCm: null,
  experienceLevel: '',
  equipmentAccess: [],
  dietaryRestrictions: [],
  notificationPermissionAsked: false,
};

export const useClientOnboardingStore = createOnboardingDraftStore<ClientOnboardingFields>(
  'onboarding-draft-client',
  initialClientFields,
);
