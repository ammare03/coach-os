// The binding between the words and the identifier they are recorded
// under (`phase-06-onboarding/onboarding-infrastructure/03`).
//
// The copy lives in `@coachos/ui` and the accepted version set lives in
// `@coachos/schemas`, and neither package may import the other — a UI
// primitive knows nothing about the API, and a schema module imports
// nothing but `zod` (`packages/schemas/src/__tests__/layout.test.ts`).
// `apps/mobile` depends on both, so this is the one place the two can be
// compared. Without it, a legal-review rewrite that changed the words and
// forgot the version would ship silently, and every acknowledgment already
// on file would claim agreement to text nobody saw.
import { me as meSchemas } from '@coachos/schemas';
import { MEDICAL_DISCLAIMER_VERSION } from '@coachos/ui';

describe('medical disclaimer version', () => {
  it('is a version the API will accept', () => {
    expect(meSchemas.medicalDisclaimerVersion.safeParse(MEDICAL_DISCLAIMER_VERSION).success).toBe(
      true,
    );
  });

  it('is the version the app records when a user acknowledges', () => {
    expect(MEDICAL_DISCLAIMER_VERSION).toBe(meSchemas.CURRENT_MEDICAL_DISCLAIMER_VERSION);
  });

  it('rejects a version nobody has shipped', () => {
    expect(meSchemas.medicalDisclaimerVersion.safeParse('not-a-version').success).toBe(false);
  });
});
