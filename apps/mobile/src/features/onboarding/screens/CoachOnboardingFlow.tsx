import { coach as coachSchemas } from '@coachos/schemas';
import { Text } from '@coachos/ui';
import { useState } from 'react';

import { COACH_ONBOARDING_STEP_COUNT, stepAt, stepNumber } from '../coach-steps.ts';
import { useCoachOnboardingStore } from '../coach-store.ts';
import { CoachOnboardingShell } from '../components/CoachOnboardingShell.tsx';
import { useCreateProgram } from '../hooks/useCreateProgram.ts';
import { useUpdateCoachProfile } from '../hooks/useUpdateCoachProfile.ts';
import { CoachProfileStep } from '../steps/CoachProfileStep.tsx';
import { DisclaimerStep } from '../steps/DisclaimerStep.tsx';
import { ProgramStep } from '../steps/ProgramStep.tsx';

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
// `CoachOnboardingShell`'s; the step supplies its fields. Advancing, and
// rolling back a failed advance, is this screen's: which step is on screen
// is flow state, and a step that could move itself would be a second place
// the flow's position lives (`code-conventions` §5).

type Step = ReturnType<typeof stepAt>;

interface StepContent {
  title: string;
  subtitle: string;
}

const STEP_CONTENT: Record<Step, StepContent> = {
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

const WRITE_FAILED = 'We couldn’t save that. Check your connection and try again.';

/** Drops anything the current build no longer recognises — a draft can outlive a list (`COACH_SPECIALTIES`). */
function knownSpecialties(values: readonly string[]): coachSchemas.CoachSpecialty[] {
  return values.filter(
    (value): value is coachSchemas.CoachSpecialty =>
      coachSchemas.coachSpecialty.safeParse(value).success,
  );
}

export function CoachOnboardingFlow() {
  const currentStep = useCoachOnboardingStore((state) => state.currentStep);
  const setStep = useCoachOnboardingStore((state) => state.setStep);
  const updateField = useCoachOnboardingStore((state) => state.updateField);
  const businessName = useCoachOnboardingStore((state) => state.fields.businessName);
  const specialties = useCoachOnboardingStore((state) => state.fields.specialties);
  const programName = useCoachOnboardingStore((state) => state.fields.programName);
  const programDays = useCoachOnboardingStore((state) => state.fields.programDays);

  const [stepError, setStepError] = useState<string | null>(null);
  const updateProfile = useUpdateCoachProfile();
  const createProgram = useCreateProgram();

  const step = stepAt(currentStep);
  const content = STEP_CONTENT[step];

  const goNext = () => {
    setStepError(null);
    setStep(currentStep + 1);
  };
  const goBack =
    currentStep > 0
      ? () => {
          setStepError(null);
          setStep(currentStep - 1);
        }
      : undefined;

  /**
   * `ui-conventions` §5's optimistic rule: the step advances now and the
   * write finishes behind it. A genuine failure returns the coach to this
   * step — with every value still in the draft store, so nothing typed is
   * lost — and says so.
   */
  function submitProfile() {
    const from = currentStep;
    goNext();
    updateProfile.mutate(
      { businessName: businessName.trim(), specialties: knownSpecialties(specialties) },
      {
        onError: () => {
          setStep(from);
          setStepError(WRITE_FAILED);
        },
      },
    );
  }

  /**
   * Step 3's write. Same optimistic shape as step 2's, with one addition:
   * the created program's id lands in the draft store, so a coach who
   * comes back to this step does not create a second program by pressing
   * Continue again — `programId` is what a later edit path would update
   * rather than re-insert.
   */
  function submitProgram() {
    const from = currentStep;
    goNext();
    createProgram.mutate(
      {
        name: programName.trim(),
        days: programDays.map((day, index) => ({
          name: day.name.trim().length > 0 ? day.name.trim() : `Day ${index + 1}`,
          exercises: day.exercises.map((exercise) => ({
            exerciseId: exercise.exerciseId,
            targetSets: exercise.targetSets,
            targetRepsMin: exercise.targetRepsMin,
            targetRepsMax: exercise.targetRepsMax,
          })),
        })),
      },
      {
        onSuccess: (program) => updateField('programId', program.id),
        onError: () => {
          setStep(from);
          setStepError(WRITE_FAILED);
        },
      },
    );
  }

  return (
    <CoachOnboardingShell
      step={stepNumber(currentStep)}
      totalSteps={COACH_ONBOARDING_STEP_COUNT}
      title={content.title}
      subtitle={content.subtitle}
      onBack={goBack}
      primaryAction={primaryActionFor(step)}
    >
      {renderStep(step)}
    </CoachOnboardingShell>
  );

  function primaryActionFor(current: Step) {
    // Step 1's Continue belongs to `MedicalDisclaimer` — the acknowledgment
    // state that enables it is internal to that component by design.
    if (current === 'disclaimer') return undefined;
    if (current === 'profile') {
      return {
        label: 'Continue',
        onPress: submitProfile,
        disabled: businessName.trim().length === 0,
      };
    }
    if (current === 'program') {
      return {
        label: 'Continue',
        onPress: submitProgram,
        disabled: programName.trim().length === 0,
      };
    }
    return { label: 'Continue', onPress: goNext, disabled: true };
  }

  function renderStep(current: Step) {
    if (current === 'disclaimer') return <DisclaimerStep onAcknowledged={goNext} />;
    if (current === 'profile') return <CoachProfileStep error={stepError ?? undefined} />;
    if (current === 'program') return <ProgramStep error={stepError ?? undefined} />;
    return <Text tone="muted">This step is built in coach-onboarding/04.</Text>;
  }
}
