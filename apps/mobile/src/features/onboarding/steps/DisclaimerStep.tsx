import { me as meSchemas } from '@coachos/schemas';
import { MedicalDisclaimer, spacing, Text } from '@coachos/ui';
import { StyleSheet } from 'react-native';

import { useMedicalDisclaimer } from '../../settings/hooks/useMedicalDisclaimer.ts';

// `coach-onboarding/01`, Approach step 3 — the flow's first gate.
//
// The acknowledgment is written before the flow moves on, never after and
// never optimistically: `useMedicalDisclaimer`'s own doc comment states
// why, and it is the one place in this flow where `ui-conventions` §5's
// "optimistic always" is deliberately not followed. A person recorded as
// onboarded with no acknowledgment on file is the failure §21.3 exists to
// prevent.
//
// It is shown on every entry rather than skipped for someone whose
// acknowledgment is already on file. The persisted `currentStep` means a
// coach who acknowledged and moved on never returns here; only a wiped
// draft does, and the write is idempotent (`apps/api/src/features/me/
// medical-disclaimer.ts`), so re-reading it costs one tap and nothing else.

export interface DisclaimerStepProps {
  /** Called once the acknowledgment has been recorded server-side. */
  onAcknowledged: () => void;
}

export function DisclaimerStep({ onAcknowledged }: DisclaimerStepProps) {
  const { acknowledge } = useMedicalDisclaimer();

  return (
    <>
      <MedicalDisclaimer
        variant="onboarding"
        submitting={acknowledge.isPending}
        onAcknowledge={() => {
          acknowledge.mutate(
            { version: meSchemas.CURRENT_MEDICAL_DISCLAIMER_VERSION },
            { onSuccess: onAcknowledged },
          );
        }}
      />
      {acknowledge.isError ? (
        <Text size="body-sm" tone="urgent" accessibilityRole="alert" style={styles.error}>
          We couldn&rsquo;t save that. Check your connection and try again.
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  error: { marginTop: spacing(12) },
});
