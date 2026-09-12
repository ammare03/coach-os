import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { clientDetailKeys } from '../../api.ts';
import type { ClientChatMessage } from '../../components/ClientChatBubble.tsx';
import { ClientChatScreen, type ClientChatThread } from '../ClientChatScreen.tsx';

// `client-detail/06`. Four things are worth a test on a shell whose data
// does not exist yet: that it reads the ONE key
// `phase-14-messaging-and-realtime` will write to, that the two absences
// this facet can be in are genuinely DIFFERENT states rather than the same
// state twice, that messages landing in that key render with no further
// change, and that the composer is present and inert in all of them.
//
// The composer's own guarantees — that it cannot take a keystroke and has
// no handler to complete — are asserted in
// `components/__tests__/ClientChatComposer.test.tsx`, which is where the
// task's single named failure mode lives.

// Both hooks mount `me.get` through tRPC, which this suite deliberately
// does not build. The zone and the name are the only things the screen uses
// them for.
jest.mock('../../../../lib/time-zone/useClientTimeZone.ts', () => ({
  useClientTimeZone: () => 'Asia/Kolkata',
}));

jest.mock('../../api.ts', () => {
  const actual = jest.requireActual('../../api.ts') as Record<string, unknown>;
  return {
    ...actual,
    useClientIdentity: () => ({ data: { name: 'Priya Sharma' } }),
  };
});

const CLIENT_A = '01924f2c-0000-7000-8000-00000000000a';
const CLIENT_B = '01924f2c-0000-7000-8000-00000000000b';

function message(overrides: Partial<ClientChatMessage> = {}): ClientChatMessage {
  return {
    messageId: '01924f2c-2222-7000-8000-000000000001',
    authorRole: 'coach',
    body: 'Depth looked much better on Tuesday.',
    // 18:40 in Asia/Kolkata, which is the zone mocked above — so the
    // rendered clock time proves the viewer's zone is applied and not UTC.
    sentAt: new Date('2026-09-08T13:10:00.000Z'),
    ...overrides,
  };
}

function thread(overrides: Partial<ClientChatThread> = {}): ClientChatThread {
  return { conversationId: null, messages: [], ...overrides };
}

function buildClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function renderScreen(
  client: QueryClient,
  props: Partial<Parameters<typeof ClientChatScreen>[0]> = {},
) {
  return render(<ClientChatScreen clientId={CLIENT_A} onOpenOverview={jest.fn()} {...props} />, {
    wrapper: wrapperFor(client),
  });
}

describe('the reserved query key', () => {
  it('is the tab factory’s, so the tab caches independently of its siblings', async () => {
    const client = buildClient();
    renderScreen(client);

    await waitFor(() => {
      expect(client.getQueryData(clientDetailKeys.tab(CLIENT_A, 'chat'))).toEqual(thread());
    });

    // Nothing is written under a sibling facet's key or another client's.
    // If the screen restated a key of its own, this is what would catch it.
    expect(client.getQueryData(clientDetailKeys.tab(CLIENT_A, 'overview'))).toBeUndefined();
    expect(client.getQueryData(clientDetailKeys.tab(CLIENT_B, 'chat'))).toBeUndefined();
  });
});

describe('the two absences', () => {
  it('shows the no-conversation empty state, and no read-only notice, when nothing has been sent', async () => {
    const client = buildClient();
    renderScreen(client);

    await waitFor(() => {
      expect(screen.getByTestId('client-chat-empty')).toBeTruthy();
    });

    expect(screen.getByText('No messages yet')).toBeTruthy();
    expect(screen.getByText('Nothing has been sent between you and this client.')).toBeTruthy();
    expect(screen.queryByTestId('client-chat-readonly-notice')).toBeNull();
  });

  it('shows the read-only notice, and no empty state, when a conversation exists', async () => {
    const client = buildClient();
    client.setQueryData(
      clientDetailKeys.tab(CLIENT_A, 'chat'),
      thread({ conversationId: '01924f2c-3333-7000-8000-000000000001', messages: [message()] }),
    );

    renderScreen(client);

    await waitFor(() => {
      expect(screen.getByTestId('client-chat-readonly-notice')).toBeTruthy();
    });

    expect(screen.getByText('READ-ONLY')).toBeTruthy();
    expect(screen.queryByTestId('client-chat-empty')).toBeNull();
  });

  it('never renders both at once — the two situations are distinguishable, not layered', async () => {
    const client = buildClient();
    renderScreen(client);

    await waitFor(() => {
      expect(screen.getByTestId('client-chat-empty')).toBeTruthy();
    });

    // The empty state's heading and the notice's eyebrow are the two
    // strings a coach reads to tell the states apart. Exactly one of them
    // is ever on screen.
    expect(screen.queryByText('READ-ONLY')).toBeNull();
    expect(screen.getByText('No messages yet')).toBeTruthy();
  });
});

describe('the bubble list', () => {
  it('renders a message that lands in the key, with no further change', async () => {
    const client = buildClient();
    client.setQueryData(
      clientDetailKeys.tab(CLIENT_A, 'chat'),
      thread({
        conversationId: '01924f2c-3333-7000-8000-000000000001',
        messages: [message()],
      }),
    );

    renderScreen(client);

    await waitFor(() => {
      expect(screen.getByText('Depth looked much better on Tuesday.')).toBeTruthy();
    });
  });

  it('announces who wrote each message, since alignment and colour are invisible to a screen reader', async () => {
    const client = buildClient();
    client.setQueryData(
      clientDetailKeys.tab(CLIENT_A, 'chat'),
      thread({
        conversationId: '01924f2c-3333-7000-8000-000000000001',
        messages: [
          message(),
          message({
            messageId: '01924f2c-2222-7000-8000-000000000002',
            authorRole: 'client',
            body: 'Felt way more stable, yeah.',
            sentAt: new Date('2026-09-08T13:32:00.000Z'),
          }),
        ],
      }),
    );

    renderScreen(client);

    await waitFor(() => {
      expect(
        screen.getByLabelText('From you, 18:40. Depth looked much better on Tuesday.'),
      ).toBeTruthy();
    });

    expect(
      screen.getByLabelText('From Priya Sharma, 19:02. Felt way more stable, yeah.'),
    ).toBeTruthy();
  });
});

describe('the composer', () => {
  it('is present and disabled in the empty state', async () => {
    const client = buildClient();
    renderScreen(client);

    await waitFor(() => {
      expect(screen.getByTestId('client-chat-empty')).toBeTruthy();
    });

    expect(screen.getByTestId('client-chat-composer-input').props.editable).toBe(false);
  });

  it('is present and disabled with a conversation on screen', async () => {
    const client = buildClient();
    client.setQueryData(
      clientDetailKeys.tab(CLIENT_A, 'chat'),
      thread({ conversationId: '01924f2c-3333-7000-8000-000000000001', messages: [message()] }),
    );

    renderScreen(client);

    await waitFor(() => {
      expect(screen.getByTestId('client-chat-readonly-notice')).toBeTruthy();
    });

    // The composer does not depend on the query above it
    // (`screen-composition` §3) — it is the same control in both states, so
    // a coach never has to learn two.
    expect(screen.getByTestId('client-chat-composer-input').props.editable).toBe(false);
  });
});
