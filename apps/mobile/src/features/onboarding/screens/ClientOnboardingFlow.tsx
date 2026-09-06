import {
  CLIENT_ONBOARDING_STEP_COUNT,
  clientStepAt,
  type ClientOnboardingStep,
} from '../client-steps.ts';
import { useClientOnboardingStore } from '../client-store.ts';
import { OnboardingShell } from '../components/OnboardingShell.tsx';
import { DisclaimerStep } from '../steps/DisclaimerStep.tsx';
import { GoalsStep } from '../steps/GoalsStep.tsx';
import { MeasurementsStep } from '../steps/MeasurementsStep.tsx';

// `phase-06-onboarding/client-onboarding/` — the whole client flow is ONE
// route (`(client-onboarding)/index`), not five, for exactly the reason
// `CoachOnboardingFlow` gives: `AuthGate`'s `GROUP_ROOT` sends a
// non-onboarded client to the group root, so a route-per-step flow would
// land them on step 1 after every cold start regardless of where they had
// got to. The persisted `currentStep` is the position; this screen renders
// it.
//
// Advancing is this screen's, never a step's — which step is on screen is
// flow state, and a step that could move itself would be a second place
// the flow's position lives (`code-conventions` §5).
//
// Steps 04 and 05 (equipment and diet, notifications) add their own
// branches to `renderStep` and their own entries to `primaryActionFor` as
// those tasks land. Until then the flow ends after measurements.

interface StepContent {
  title: string;
  subtitle: string;
}

const STEP_CONTENT: Record<ClientOnboardingStep, StepContent> = {
  disclaimer: {
    title: 'Before you start',
    subtitle: 'Read this once. It stays in Settings if you want it again.',
  },
  goals: {
    title: 'What are you after?',
    subtitle: 'Pick the one that fits best. Your coach can change it with you later.',
  },
  measurements: {
    title: 'A bit about you',
    subtitle: 'Your coach uses these to size your training. Nothing here is shown to anyone else.',
  },
  equipment: {
    title: 'What you train with',
    subtitle: 'Your coach builds around what you actually have. Pick everything that applies.',
  },
  notifications: {
    title: 'Want a nudge?',
    subtitle: 'Three things, and nothing else. You can turn any of them off later in Settings.',
  },
};

export function ClientOnboardingFlow() {
  const currentStep = useClientOnboardingStore((state) => state.currentStep);
  const setStep = useClientOnboardingStore((state) => state.setStep);
  const updateField = useClientOnboardingStore((state) => state.updateField);
  const goal = useClientOnboardingStore((state) => state.fields.goal);
  const dateOfBirth = useClientOnboardingStore((state) => state.fields.dateOfBirth);
  const sexAtBirth = useClientOnboardingStore((state) => state.fields.sexAtBirth);
  const heightCm = useClientOnboardingStore((state) => state.fields.heightCm);
  const experienceLevel = useClientOnboardingStore((state) => state.fields.experienceLevel);
  const startedAt = useClientOnboardingStore((state) => state.fields.startedAt);

  const step = clientStepAt(currentStep);
  const content = STEP_CONTENT[step];

  const goNext = () => {
    // The stopwatch for `onboarding_completed.duration_s` (§20), stamped on
    // the first transition rather than on mount — an effect writing to the
    // store on every render would restart the clock every time the flow
    // was reopened (`useFinishCoachOnboarding` reads the coach twin).
    if (startedAt === null) updateField('startedAt', Date.now());
    setStep(currentStep + 1);
  };

  const goBack = currentStep > 0 ? () => setStep(currentStep - 1) : undefined;

  return (
    <OnboardingShell
      step={currentStep + 1}
      totalSteps={CLIENT_ONBOARDING_STEP_COUNT}
      title={content.title}
      subtitle={content.subtitle}
      onBack={goBack}
      primaryAction={primaryActionFor(step)}
    >
      {renderStep(step)}
    </OnboardingShell>
  );

  function primaryActionFor(current: ClientOnboardingStep) {
    // Step 1's Continue belongs to `MedicalDisclaimer` — the acknowledgment
    // state that enables it is internal to that component by design.
    if (current === 'disclaimer') return undefined;
    if (current === 'goals') {
      return { label: 'Continue', onPress: goNext, disabled: goal.length === 0 };
    }
    if (current === 'measurements') {
      // Every field on the step, because a coach sizing training needs all
      // four — and each one is only ever written to the draft once it is
      // valid, so "present" and "valid" are the same check here.
      return {
        label: 'Continue',
        onPress: goNext,
        disabled:
          dateOfBirth.length === 0 ||
          sexAtBirth.length === 0 ||
          heightCm === null ||
          experienceLevel.length === 0,
      };
    }
    return undefined;
  }

  function renderStep(current: ClientOnboardingStep) {
    if (current === 'disclaimer') return <DisclaimerStep onAcknowledged={goNext} />;
    if (current === 'goals') return <GoalsStep />;
    if (current === 'measurements') return <MeasurementsStep />;
    return null;
  }
}
