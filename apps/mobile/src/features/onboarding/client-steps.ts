// The client flow's step sequence (`phase-06-onboarding/client-onboarding/`),
// the sibling of `coach-steps.ts` and read by the same three things: the
// shell's progress indicator, the flow's step switch, and `client-store.ts`'s
// persisted `currentStep`.
//
// **Five steps, with the medical disclaimer as step 1** — the same shape the
// coach flow uses, for the same reason (`coach-steps.ts`): §21.3 requires
// the disclaimer "at onboarding", `onboarding-infrastructure/03` already
// built it in a step's shape, and a separate pre-flow screen would show a
// person a step counter that starts at 1 on their *second* screen.
//
// ⚠️ `client-onboarding/README.md` also calls this a "five-step flow", but
// counts differently: invite-code entry, goals, measurements,
// equipment/dietary, notifications. That is the journey; this is the
// sequence *inside* the `(client-onboarding)` group. Invite entry is not one
// of these steps — it lives in `(auth)` and is the gate a person passes
// before the flow exists for them at all (`client-onboarding/01`). The two
// counts landing on the same number is a coincidence, not a claim.

export const CLIENT_ONBOARDING_STEPS = [
  'disclaimer',
  'goals',
  'measurements',
  'equipment',
  'notifications',
] as const;

export type ClientOnboardingStep = (typeof CLIENT_ONBOARDING_STEPS)[number];

export const CLIENT_ONBOARDING_STEP_COUNT = CLIENT_ONBOARDING_STEPS.length;

/**
 * The step at a persisted index, clamped — a draft written by an older
 * build can carry an index this build no longer has. Identical in shape to
 * `coach-steps.ts`'s, and deliberately not shared with it: two flows with
 * two different lists agreeing on one clamp helper is one import away from
 * one flow's clamp using the other's length.
 */
export function clientStepAt(index: number): ClientOnboardingStep {
  const clamped = Math.min(Math.max(index, 0), CLIENT_ONBOARDING_STEPS.length - 1);
  // `noUncheckedIndexedAccess` — the clamp proves the index is in range,
  // and the fallback keeps that proof visible instead of asserting it.
  return CLIENT_ONBOARDING_STEPS[clamped] ?? 'disclaimer';
}
