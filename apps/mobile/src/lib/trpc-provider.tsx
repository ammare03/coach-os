import { QueryClientProvider } from '@tanstack/react-query';
import { type PropsWithChildren, useState } from 'react';

import { queryClient } from './query-client.ts';
import { buildLinks } from './trpc-links.ts';
import { api } from './trpc.ts';

// Composes the tRPC client and `queryClient` into one provider. Mounted in
// `app/_layout.tsx` — minimal, temporary wiring; `phase-05-app-shell/providers-and-gates/`
// replaces the whole file, this component included.
export function TRPCProvider({ children }: PropsWithChildren) {
  const [trpcClient] = useState(() => api.createClient({ links: buildLinks() }));

  return (
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </api.Provider>
  );
}
