import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { clientDetailKeys } from '../../api.ts';
import { ClientNutritionScreen } from '../ClientNutritionScreen.tsx';

// The two things `client-detail/03` actually ships, asserted against real
// TanStack Query rather than a stubbed hook: the tab renders a designed
// empty state, and it owns its own cache entry.
//
// The second assertion is the one with teeth. It is what makes
// `phase-13-nutrition`'s eventual change a one-line `queryFn` — if the key
// drifted, or if the tab quietly fetched Overview to fill itself, that
// phase would be editing this feature's shell instead of adding a query.

const CLIENT_A = '01924f2c-0000-7000-8000-00000000000a';
const CLIENT_B = '01924f2c-0000-7000-8000-00000000000b';

// The reserved entry carries the persister's 24h `gcTime`, so unmounting
// arms a 24h garbage-collection timeout. Left behind, that is what Jest
// reports as "a worker process has failed to exit gracefully".
let client: QueryClient | null = null;

afterEach(() => {
  client?.clear();
  client = null;
});

function renderScreen(clientId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client = queryClient;

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  render(<ClientNutritionScreen clientId={clientId} />, { wrapper: Wrapper });

  return queryClient;
}

describe('ClientNutritionScreen', () => {
  it('renders the designed empty state, not a spinner', () => {
    renderScreen(CLIENT_A);

    // Queried by role, not by testID: a screen reader reaching this tab
    // must find a heading, which is also what `EmptyState` produces
    // (`accessibility` §2).
    expect(screen.getByRole('header', { name: 'No food logged yet.' })).toBeTruthy();
    expect(
      screen.getByText(
        'Once your client logs a meal, their day shows here: what they ate, how it lands against their targets, and any photos they attached.',
      ),
    ).toBeTruthy();
  });

  it('reserves its own cache entry and never fetches', () => {
    const queryClient = renderScreen(CLIENT_A);

    const reserved = queryClient
      .getQueryCache()
      .find({ queryKey: clientDetailKeys.tab(CLIENT_A, 'nutrition') });

    expect(reserved).toBeDefined();
    // Idle, not pending-with-a-fetch-in-flight: nothing is called, so
    // nothing can hang. This is the assertion that would fail if someone
    // wired an enabled query to a procedure that does not exist yet.
    expect(reserved?.state.fetchStatus).toBe('idle');
    expect(reserved?.state.data).toBeUndefined();
    expect(reserved?.state.status).not.toBe('error');
  });

  it('reserves that key and nothing else', () => {
    const queryClient = renderScreen(CLIENT_A);
    const cache = queryClient.getQueryCache();

    // Per-tab independence (§8.3): the Nutrition tab does not drag the
    // Overview payload in behind it, which is what a shared key or a
    // convenience call for the client's name would do.
    expect(cache.find({ queryKey: clientDetailKeys.tab(CLIENT_A, 'overview') })).toBeUndefined();
    // Per-client independence: one client's tab never populates another's.
    expect(cache.find({ queryKey: clientDetailKeys.tab(CLIENT_B, 'nutrition') })).toBeUndefined();
    expect(cache.getAll()).toHaveLength(1);
  });

  it('renders no nutrition content — the diary is phase-13-nutrition, not this task', () => {
    renderScreen(CLIENT_A);

    // A guard against the one failure this task's Risks section names:
    // placeholder macros or a mock diary shipped "so the tab looks
    // finished". Every digit this screen could render is a number the
    // product does not have, so the strongest assertion available is that
    // it renders none at all.
    expect(screen.getByTestId('client-nutrition-empty')).toBeTruthy();
    expect(screen.queryByText(/\d/)).toBeNull();
    expect(screen.queryByText(/kcal|protein|carb/i)).toBeNull();
  });
});
