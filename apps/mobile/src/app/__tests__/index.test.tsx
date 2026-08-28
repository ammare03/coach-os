import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';

import { api } from '../../lib/trpc.ts';
import HomeScreen from '../index.tsx';

// `HomeScreen` calls `api.health.ping.useQuery()`, so it needs both
// providers mounted — same as `TRPCProvider` does in `app/_layout.tsx`,
// just with an isolated client per test rather than the shared singleton.
function renderHomeScreen() {
  // `retry: false` — the dummy link below never resolves the query, and the
  // default retry/backoff timers would otherwise outlive the test and leak
  // (Jest's "worker failed to exit gracefully" warning).
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = api.createClient({
    links: [
      () =>
        ({ next, op }) =>
          next(op),
    ],
  });

  return render(
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <HomeScreen />
      </QueryClientProvider>
    </api.Provider>,
  );
}

describe('HomeScreen', () => {
  it('renders without an ESM transform error', () => {
    renderHomeScreen();

    expect(screen.getByText('CoachOS')).toBeTruthy();
  });
});
