'use client';

// The one interactive part of the route, and the only reason there is any
// client JavaScript here at all.
//
// A real `<form>` with a real `<button>`: React's progressive enhancement
// posts it even with JS disabled, and `useActionState`'s returned state is
// rendered server-side on that response. Nothing about this page depends on
// the client bundle arriving.

import { useActionState } from 'react';

import type { GuardianConsentOutcome } from './confirm';
import { AlreadyConfirmed, Confirmed, Intro, Invalid, Unavailable } from './states';

export type ConfirmAction = (
  previous: GuardianConsentOutcome | null,
  formData: FormData,
) => Promise<GuardianConsentOutcome>;

export function ConsentForm({ action }: { action: ConfirmAction }) {
  const [outcome, submit, pending] = useActionState<GuardianConsentOutcome | null, FormData>(
    action,
    null,
  );

  const button = (
    <form action={submit}>
      <button className="gc-button" type="submit" disabled={pending}>
        {pending ? 'Confirming…' : "I confirm — I'm their parent or guardian"}
      </button>
    </form>
  );

  if (outcome === null) return <Intro action={button} />;

  switch (outcome.outcome) {
    case 'confirmed':
      return <Confirmed clientName={outcome.clientName} />;
    case 'already_confirmed':
      return <AlreadyConfirmed />;
    case 'invalid':
      return <Invalid />;
    case 'unavailable':
      return <Unavailable action={button} />;
  }
}
