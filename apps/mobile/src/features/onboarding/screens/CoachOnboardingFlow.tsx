import { Text } from '@coachos/ui';

import { COACH_ONBOARDING_STEP_COUNT, stepAt, stepNumber } from '../coach-steps.ts';
import { useCoachOnboardingStore } from '../coach-store.ts';
import { CoachOnboardingShell } from '../components/CoachOnboardingShell.tsx';
import { DisclaimerStep } from '../steps/DisclaimerStep.tsx';

// `phase-06-onboarding/coach-onboarding/01` — the whole flow is ONE route
// (`(coach-onboarding)/index`), not four.
//
// That is a consequence of `onboarding-infrastructure/02`'s gate, not a
// preference: `AuthGate`'s `GROUP_ROOT` sends a non-onboarded coach to the
// group root, so a four-route flow would land them on step 1 after every
// cold start regardless of where they had got to. The persisted
// `currentStep` is the position, and this screen renders it.
//
// The step's chrome — progress, back, title, primary action — is
// `CoachOnboardingShell`'s; the step supplies its fields. Tasks 02–04
// replace the placeholders below with the real ones.

interface StepContent {
  title: string;
  subtitle: string;
}

const STEP_CONTENT: Record<ReturnType<typeof stepAt>, StepContent> = {
  disclaimer: {
    title: 'Before you start',
    subtitle: 'Read this once. It stays in Settings if you want it again.',
  },
  profile: {
    title: 'About your coaching',
    subtitle: 'This is what your clients see. You can change both later in Settings.',
  },
  program: {
    title: 'Your first program',
    subtitle: 'Three days to start. Add weeks, supersets and detail later in Programs.',
  },
  invite: {
    title: 'Invite your first client',
    subtitle: 'They get an email with a code. Nothing is shared until they accept it.',
  },
};

export function CoachOnboardingFlow() {
  const currentStep = useCoachOnboardingStore((state) => state.currentStep);
  const setStep = useCoachOnboardingStore((state) => state.setStep);
  const step = stepAt(currentStep);
  const content = STEP_CONTENT[step];

  const goNext = () => setStep(currentStep + 1);
  const goBack = currentStep > 0 ? () => setStep(currentStep - 1) : undefined;

  return (
    <CoachOnboardingShell
      step={stepNumber(currentStep)}
      totalSteps={COACH_ONBOARDING_STEP_COUNT}
      title={content.title}
      subtitle={content.subtitle}
      onBack={goBack}
      // Steps 2–4 pass their own action once they exist; step 1's Continue
      // belongs to `MedicalDisclaimer` (see `CoachOnboardingShell`'s props).
      primaryAction={
        step === 'disclaimer' ? undefined : { label: 'Continue', onPress: goNext, disabled: true }
      }
    >
      {step === 'disclaimer' ? (
        <DisclaimerStep onAcknowledged={goNext} />
      ) : (
        <Text tone="muted">This step is built in coach-onboarding/{stepTaskNumber(step)}.</Text>
      )}
    </CoachOnboardingShell>
  );
}

/** Which task fills each placeholder — visible on screen while it is still one. */
function stepTaskNumber(step: ReturnType<typeof stepAt>): string {
  if (step === 'profile') return '02';
  if (step === 'program') return '03';
  return '04';
}
