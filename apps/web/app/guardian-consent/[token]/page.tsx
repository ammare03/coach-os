// `/guardian-consent/{token}` — public, no session, no cookie, no CoachOS
// account (`guardian-consent/05`). The guardian is a parent following a
// link from an email in whatever browser their phone opened.
//
// This module imports nothing that can spend the token. `./confirm` is
// reachable only through `./actions`, which the client component invokes on
// submit — so a `GET` renders and consumes nothing, which is the single
// most important decision in the task: link scanners, preview generators
// and corporate mail gateways fetch URLs before the human does, and a burnt
// token is indistinguishable from an expired one from a support ticket.

import type { Metadata } from 'next';

import { confirmAction } from './actions';
import { ConsentForm } from './consent-form';
import { Shell } from './states';
import './styles.css';

// The path carries a live single-use credential. `noindex` is also set in
// the layout; repeated here so a future marketing site relaxing that one
// cannot silently expose this route.
export const metadata: Metadata = {
  title: 'Confirm consent · CoachOS',
  robots: { index: false, follow: false, nocache: true },
};

// Never prerendered or cached: the token is per-request and the response
// differs per submission.
export const dynamic = 'force-dynamic';

export default async function GuardianConsentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <Shell>
      <ConsentForm action={confirmAction.bind(null, token)} />
    </Shell>
  );
}
