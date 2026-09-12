import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { clientDetailKeys } from '../../api.ts';
import type { ClientCheckin } from '../../components/ClientCheckinsRow.tsx';
import { ClientCheckinsScreen } from '../ClientCheckinsScreen.tsx';

// `client-detail/05`. Three things are worth a test on a shell whose data
// does not exist yet: that it reads the ONE key `phase-17-structured-
// checkins` will write to, that a client with no check-ins gets a designed
// state rather than a blank screen, and that a row landing in that key
// renders without any further change — which is the whole claim the
// forward-hook pattern makes (P10 README).

// The hook mounts `me.get` through tRPC, which this suite deliberately does
// not build. The zone it returns is the only thing the screen uses it for.
jest.mock('../../../../lib/time-zone/useClientTimeZone.ts', () => ({
  useClientTimeZone: () => 'Asia/Kolkata',
}));

const CLIENT_A = '01924f2c-0000-7000-8000-00000000000a';
const CLIENT_B = '01924f2c-0000-7000-8000-00000000000b';

function checkin(overrides: Partial<ClientCheckin> = {}): ClientCheckin {
  return {
    checkinId: '01924f2c-1111-7000-8000-000000000001',
    status: 'submitted',
    periodStart: '2026-09-08',
    periodEnd: '2026-09-14',
    submittedAt: new Date('2026-09-14T10:00:00.000Z'),
    reviewedAt: null,
    ...overrides,
  };
}

// Every entry this screen creates carries `gcTime: QUERY_CACHE_MAX_AGE_MS`
// (24h), which is a 24-hour garbage-collection timer per query. Left
// running it keeps Jest's event loop alive long after the last assertion
// and the worker never exits. `clear()` drops the entries and their timers
// with them.
const clients: QueryClient[] = [];

function buildClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return client;
}

afterEach(() => {
  while (clients.length > 0) clients.pop()?.clear();
});

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function renderScreen(
  client: QueryClient,
  props: Partial<Parameters<typeof ClientCheckinsScreen>[0]> = {},
) {
  return render(
    <ClientCheckinsScreen
      clientId={CLIENT_A}
      onOpenCheckin={jest.fn()}
      onOpenOverview={jest.fn()}
      {...props}
    />,
    { wrapper: wrapperFor(client) },
  );
}

describe('the reserved query key', () => {
  it('is the tab factory’s, so the tab caches independently of its siblings', async () => {
    const client = buildClient();
    renderScreen(client);

    await waitFor(() => {
      expect(client.getQueryData(clientDetailKeys.tab(CLIENT_A, 'checkins'))).toEqual([]);
    });

    // Nothing this screen does may reach a sibling facet's entry — that is
    // what §8.3's "every tab is independently cached" means in the cache
    // rather than in prose.
    expect(client.getQueryData(clientDetailKeys.tab(CLIENT_A, 'overview'))).toBeUndefined();
    expect(client.getQueryData(clientDetailKeys.tab(CLIENT_B, 'checkins'))).toBeUndefined();
  });

  it('renders whatever lands in that key, with no other change', async () => {
    // `phase-17-structured-checkins` replaces one function and its rows
    // arrive here. Seeding the key directly is that swap, proved rather
    // than promised.
    const client = buildClient();
    client.setQueryData(clientDetailKeys.tab(CLIENT_A, 'checkins'), [
      checkin(),
      checkin({
        checkinId: '01924f2c-1111-7000-8000-000000000002',
        status: 'missed',
        periodStart: '2026-08-25',
        periodEnd: '2026-08-31',
        submittedAt: null,
      }),
    ]);

    renderScreen(client);

    expect(await screen.findByLabelText(/8 September to 14 September/)).toBeTruthy();
    expect(screen.getByLabelText(/25 August to 31 August/)).toBeTruthy();
    expect(screen.queryByTestId('client-checkins-empty')).toBeNull();
  });
});

describe('a client with no check-ins', () => {
  it('shows the designed empty state, not a blank screen', async () => {
    const client = buildClient();
    renderScreen(client);

    expect(await screen.findByTestId('client-checkins-empty')).toBeTruthy();
    expect(screen.getByText('No check-ins yet')).toBeTruthy();
    // States the fact, then offers exactly one next step — no apology and
    // no exclamation mark (`COPY.md` §CO4.1).
    expect(
      screen.getByText('Check-ins appear here once this client has one scheduled.'),
    ).toBeTruthy();
  });

  it('offers the one next step that exists before phase-17 ships', async () => {
    const onOpenOverview = jest.fn();
    const client = buildClient();
    renderScreen(client, { onOpenOverview });

    const action = await screen.findByRole('button', { name: 'Back to overview' });
    fireEvent.press(action);

    // The action never depends on the query (`screen-composition` §3): it
    // needs only the route param, so it works even when the tab does not.
    expect(onOpenOverview).toHaveBeenCalledTimes(1);
  });

  it('is a permanent, correct state — never a spinner that will not resolve', async () => {
    const client = buildClient();
    renderScreen(client);

    await screen.findByTestId('client-checkins-empty');

    expect(screen.queryByLabelText('Loading check-ins')).toBeNull();
  });
});

describe('first load', () => {
  it('reserves the list’s shape with a skeleton rather than a spinner', () => {
    // `DESIGN.md` §5 forbids a spinner where a skeleton belongs, and the
    // skeleton is the row at the row's height so nothing shifts when the
    // list lands (`UI-UX.md` §UX4).
    const client = buildClient();
    renderScreen(client);

    expect(screen.getByLabelText('Loading check-ins')).toBeTruthy();
  });
});
