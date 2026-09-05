import { type PropsWithChildren, useState } from 'react';

import { queryClient } from './query-client.ts';
import { buildLinks } from './trpc-links.ts';
import { api } from './trpc.ts';

// The tRPC client, and only that. `QueryClientProvider` used to be nested
// inside this component; `providers-and-gates/01` lifted it out to
// `src/app/_layout.tsx`, one layer further out, so the dependency direction
// — tRPC's React integration is a layer over TanStack Query — is visible in
// the one file that owns provider order rather than hidden here.
export function TRPCProvider({ children }: PropsWithChildren) {
  const [trpcClient] = useState(() => api.createClient({ links: buildLinks() }));

  return (
    <api.Provider client={trpcClient} queryClient={queryClient}>
      {children}
    </api.Provider>
  );
}
