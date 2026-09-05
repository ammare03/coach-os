// ⚠️ PLACEHOLDER COPY — PENDING LEGAL REVIEW BEFORE PRODUCTION LAUNCH.
//
// `CLAUDE.md` §21.3: "Get a lawyer before launch. Terms of Service, Privacy
// Policy, DPA, and the coach↔client data-controller relationship need real
// legal review. Nothing in this file is legal advice." Nothing below has
// had that review. It covers the SUBSTANCE §21.3 requires — CoachOS is not
// a medical service, it never diagnoses, never prescribes, never promises
// an outcome — so the mechanism around it (the acknowledgment, the record,
// the settings copy) can be built and tested. It is not finalised legal
// language and must not ship to production as though it were.
//
// **When the review lands, change the words AND add a new version** to
// `MEDICAL_DISCLAIMER_VERSIONS` in `packages/schemas/src/me.ts`, then point
// `VERSION` below at it. Editing these strings under an unchanged version
// silently rewrites text people have already agreed to, which is the exact
// failure the version exists to prevent
// (`phase-06-onboarding/onboarding-infrastructure/03`).
//
// `COPY.md` §CO8 / `product-copy` §8: a legal disclaimer's wording is not
// tone-editable. Do not "improve" these lines — replace them with the
// reviewed ones.

/**
 * The identifier the acknowledgment is recorded against. Must be a member
 * of `MEDICAL_DISCLAIMER_VERSIONS` in `packages/schemas` —
 * `apps/mobile/src/features/settings/__tests__/medical-disclaimer-version.test.ts`
 * fails the build if it drifts. `packages/ui` cannot import `@coachos/schemas`
 * (it is not a dependency, deliberately: a UI primitive knows nothing about
 * the API), which is why the binding is a test rather than an import.
 */
export const MEDICAL_DISCLAIMER_VERSION = '2026-09-placeholder';

export const MEDICAL_DISCLAIMER_COPY = {
  eyebrow: 'CoachOS and your health',
  title: 'CoachOS is not a medical service',
  paragraphs: [
    'CoachOS is a tool for coaches and the people they coach. It records what you log and carries what your coach tells you. It is not a medical service.',
    'Nothing here is a diagnosis, a treatment, or a prescription. CoachOS cannot tell you whether an exercise, a food, or a plan is safe for you.',
    'Your coach decides what to program for you. CoachOS does not review, approve, or supervise their coaching.',
    'Talk to a doctor or another qualified health professional before you start or change how you train or eat, and any time something hurts or feels wrong.',
  ],
  emergency: 'If you think you have a medical emergency, call your local emergency number.',
  acknowledgeLabel:
    'I understand that CoachOS is not a medical service and does not give medical advice.',
  continueLabel: 'Continue',
} as const;
