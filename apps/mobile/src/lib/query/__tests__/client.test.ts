import { queryClient, queryPersistence } from '../client.ts';
import { keys } from '../keys.ts';

// The QueryClient's own configuration, and the one behaviour that is easy to
// get wrong and impossible to see: what the app does when SQLite is not
// there. `expo-sqlite` is deliberately NOT mocked here — this file runs
// against the same "no native module" environment a web build or a broken
// device gives us.

describe('the query client', () => {
  const defaults = queryClient.getDefaultOptions();

  // The 24h `gcTime` below is a real 24h `setTimeout` per cached query.
  // In the app that is the point; in Jest it is a handle that outlives the
  // run and force-exits the worker.
  afterEach(() => queryClient.clear());

  it('holds cached data for the full persistence window', () => {
    // A gcTime shorter than the persister's maxAge evicts the rows the
    // persister just restored, which looks like the cache never worked.
    expect(defaults.queries?.gcTime).toBe(24 * 60 * 60 * 1000);
  });

  it('serves from cache first and revalidates behind it', () => {
    // §19 — a cached dashboard paints in < 200ms.
    expect(defaults.queries?.staleTime).toBe(60 * 1000);
    expect(defaults.queries?.refetchOnReconnect).toBe(true);
    // RN's focus semantics differ from the web's; foreground prefetch is
    // explicit (`offline-sync` skill §2), not a refetch-everything.
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
  });

  it('runs without persistence rather than failing when SQLite is unavailable', async () => {
    // The app is fully functional with a cold cache. The failure is
    // recorded, not thrown — `providers-and-gates/05` reports it to Sentry.
    await expect(queryPersistence).resolves.toMatchObject({ status: 'unavailable' });
  });

  it('still serves reads from memory with persistence unavailable', async () => {
    await queryPersistence;
    queryClient.setQueryData(keys.clients.list(), [{ id: 'c1' }]);

    expect(queryClient.getQueryData(keys.clients.list())).toEqual([{ id: 'c1' }]);
  });
});
