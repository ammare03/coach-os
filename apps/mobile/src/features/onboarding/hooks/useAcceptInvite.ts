// `client-onboarding/01` — the signed-out acceptance call, and the routing
// that follows it.
//
// Every acceptance error gets its own copy, read off the catalogued code
// and never off `error.message` (`lib/error-code.ts`). The one code that
// is not a message is `GUARDIAN_CONSENT_REQUIRED`: the server is telling
// the screen to ask for one more field and try again, so this hook exposes
// it as a flag rather than a sentence.
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { getErrorCode } from '../../../lib/error-code.ts';
import { api } from '../../../lib/trpc.ts';
import { buildDeviceFields } from '../../auth/device.ts';
import { commitOpenedSession } from '../../auth/session-result.ts';

export interface AcceptInviteValues {
  code: string;
  name: string;
  password: string;
  /** Already `yyyy-MM-dd` — the caller converts from what was typed. */
  dateOfBirth: string;
  guardianEmail?: string;
}

const ERROR_COPY: Record<string, string> = {
  INVITE_NOT_FOUND: 'That code isn’t valid. Check it against the email your coach sent.',
  INVITE_EXPIRED: 'This invite has expired. Ask your coach for a new one.',
  INVITE_ALREADY_ACCEPTED:
    'This invite has already been used. If that wasn’t you, ask your coach for a new one.',
  INVITE_REVOKED: 'This invite was cancelled. Ask your coach for a new one.',
  SEAT_LIMIT_REACHED:
    'Your coach’s plan is full right now. Let them know — they can make room for you.',
  AGE_BELOW_MINIMUM: 'You need to be at least 13 to use CoachOS.',
  VALIDATION_FAILED: 'Check the highlighted fields and try again.',
  RATE_LIMITED: 'Too many tries just now. Wait a minute and try again.',
};

const GENERIC = 'We couldn’t accept that invite. Check your connection and try again.';

export interface AcceptInviteResult {
  acceptInvite: (values: AcceptInviteValues) => Promise<void>;
  isAccepting: boolean;
  error: string | null;
  /** The server has said this caller is 13–17 and needs a guardian's address before it will proceed. */
  needsGuardianEmail: boolean;
}

export function useAcceptInvite(): AcceptInviteResult {
  const mutation = api.invites.accept.useMutation();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [needsGuardianEmail, setNeedsGuardianEmail] = useState(false);

  async function acceptInvite(values: AcceptInviteValues): Promise<void> {
    setError(null);
    try {
      const device = await buildDeviceFields();
      const session = await mutation.mutateAsync({
        code: values.code,
        name: values.name,
        password: values.password,
        dateOfBirth: values.dateOfBirth,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(values.guardianEmail === undefined ? {} : { guardianEmail: values.guardianEmail }),
        ...device,
      });
      await commitOpenedSession(session);

      // The route this screen sits on is `AuthGate`-exempt, so the gate
      // will not move a freshly-authenticated caller off it on its own —
      // that exemption is what let them see this screen while signed in.
      // The navigation is therefore explicit, and it goes to the group
      // root rather than a step: `onboarding-infrastructure/02`'s gate
      // owns which screen a client belongs on, and the persisted
      // `currentStep` owns where in the flow they are.
      router.replace('/(client-onboarding)');
    } catch (caught) {
      const code = getErrorCode(caught);
      if (code === 'GUARDIAN_CONSENT_REQUIRED') {
        setNeedsGuardianEmail(true);
        setError('You’ll need a parent or guardian’s email before you can get started.');
        return;
      }
      setError((code === null ? undefined : ERROR_COPY[code]) ?? GENERIC);
    }
  }

  return { acceptInvite, isAccepting: mutation.isPending, error, needsGuardianEmail };
}
