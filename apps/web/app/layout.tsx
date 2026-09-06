import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// `noindex` for the whole app, not just the one route that needs it
// (`guardian-consent/05` Approach step 5). Everything `apps/web` serves
// today is either a placeholder or a URL carrying a live single-use
// credential, and defaulting to indexable is the wrong way round on a
// domain that already answers. The marketing site (P25) opts its own
// routes back in when there is something worth indexing.
export const metadata: Metadata = {
  title: 'CoachOS',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
