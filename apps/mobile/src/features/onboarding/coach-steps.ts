// The coach flow's step sequence (`phase-06-onboarding/coach-onboarding/`).
// One list, in one place, because three separate things read it: the shell's
// progress indicator, the flow's step switch, and `coach-store.ts`'s
// persisted `currentStep`. Two of those disagreeing is how a resumed draft
// lands on the wrong screen.
//
// The medical disclaimer is step 1 rather than a gate before the flow.
// §21.3 requires it "at onboarding", `onboarding-infrastructure/03` already
// built it in a step's shape — progress row, title, one decision, one
// Continue — and a separate pre-flow screen would show a person a step
// counter that starts at 1 on their *second* screen.

export const COACH_ONBOARDING_STEPS = ['disclaimer', 'profile', 'program', 'invite'] as const;

export type CoachOnboardingStep = (typeof COACH_ONBOARDING_STEPS)[number];

export const COACH_ONBOARDING_STEP_COUNT = COACH_ONBOARDING_STEPS.length;

/**
 * `coach-store.ts` holds `currentStep` as a 0-based index; `StepProgress`
 * and every piece of copy count from 1. Converting in one named function
 * rather than sprinkling `+ 1` is what keeps an off-by-one from reaching a
 * screen that says "Step 0 of 4".
 */
export function stepNumber(index: number): number {
  return index + 1;
}

/**
 * The step at a persisted index, clamped. A draft written by an older build
 * can carry an index this build no longer has — the flow must open on a
 * real step rather than render nothing.
 */
export function stepAt(index: number): CoachOnboardingStep {
  const clamped = Math.min(Math.max(index, 0), COACH_ONBOARDING_STEPS.length - 1);
  // `noUncheckedIndexedAccess` — the clamp above proves the index is in
  // range, and the fallback keeps that proof visible instead of asserting it.
  return COACH_ONBOARDING_STEPS[clamped] ?? 'disclaimer';
}
