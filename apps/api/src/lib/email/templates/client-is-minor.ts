// The coach-facing notice `auth-server/07`'s Approach step 5 requires: the
// coach is told their new client is under 18, and what that changes, at the
// one moment it becomes true. No roster badge exists yet to carry it —
// `phase-10-coach-review-surfaces/client-detail/` is where that lands.
//
// **Props are `clientName` alone, deliberately.** The birthdate, the age in
// years, and the guardian's address are all things the coach is not told
// (`CLAUDE.md` §21.5), and keeping them off the signature means adding one
// later is a deliberate change a reviewer sees, not a widening nobody
// notices. `COPY.md` §CO1: this states a fact — it does not imply the coach
// or the client did anything wrong.
//
// `.ts`, not `.tsx` — see `../layout.ts`'s doc comment for why (`docs/UNFORGET.md` S3).
import { Text } from '@react-email/components';
import { createElement, Fragment } from 'react';

import { EmailLayout } from '../layout.ts';

export interface ClientIsMinorEmailProps {
  clientName: string;
}

export function ClientIsMinorEmail({ clientName }: ClientIsMinorEmailProps) {
  const heading = `${clientName} is under 18`;

  return createElement(EmailLayout, {
    preheading: heading,
    heading,
    // No action button: there is nothing for the coach to do, and offering
    // one would imply otherwise.
    body: createElement(
      Fragment,
      null,
      createElement(
        Text,
        { style: { fontSize: '14px', lineHeight: '20px', margin: '0 0 12px' } },
        `${clientName} accepted your invite and is under 18, so a parent or guardian confirms the account before coaching starts. We have asked them to confirm. Nothing is needed from you.`,
      ),
      createElement(
        Text,
        { style: { fontSize: '14px', lineHeight: '20px', margin: 0 } },
        'Photo-based check-ins and progress photos are not part of an under-18 account. Programs, logging, and messaging work the same as for any other client.',
      ),
    ),
  });
}
