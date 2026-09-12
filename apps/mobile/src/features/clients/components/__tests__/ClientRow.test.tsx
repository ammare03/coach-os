import { fireEvent, render, screen } from '@testing-library/react-native';

import type { CoachDashboardClient } from '../../hooks/useCoachDashboard.ts';
import { CLIENT_ROW_HEIGHT, ClientRow } from '../ClientRow.tsx';

// `2026-09-12T10:00:00Z` minus two hours, so `formatRelativeToNow` has a
// fixed answer rather than one that drifts with the clock.
const NOW = new Date('2026-09-12T10:00:00.000Z');

function makeClient(overrides: Partial<CoachDashboardClient> = {}): CoachDashboardClient {
  return {
    clientId: '01924f2c-0000-7000-8000-000000000001',
    name: 'Priya Sharma',
    status: 'active',
    goal: 'fat_loss',
    avatarAssetId: null,
    unreadMessages: 4,
    lastActiveAt: new Date('2026-09-12T08:00:00.000Z'),
    sessionsCompleted7d: 4,
    sessionsScheduled7d: 5,
    unreviewedSessions: 1,
    unreviewedVideos: 0,
    latestWeightKg: 62.5,
    trainingAdherence: 80,
    nutritionAdherence: 95,
    overallAdherence: 86,
    adherenceColor: 'green',
    ...overrides,
  };
}

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterAll(() => {
  jest.useRealTimers();
});

describe('ClientRow', () => {
  it('reads as one accessible element naming both adherence states in words', () => {
    render(<ClientRow client={makeClient()} onPress={jest.fn()} />);

    // §8.2's whole field set in one sentence. The two dot states arrive as
    // WORDS, which is what makes the row usable with no colour vision and
    // what stops a coach hearing six fragments per client
    // (`accessibility` §2, §4).
    expect(
      screen.getByLabelText(
        'Priya Sharma. Training drifting, nutrition on plan. 4 of 5 sessions, active about 2 hours ago. 4 unread messages.',
      ),
    ).toBeTruthy();
  });

  it('shows the name and the factual session line', () => {
    render(<ClientRow client={makeClient()} onPress={jest.fn()} />);

    expect(screen.getByText('Priya Sharma')).toBeTruthy();
    // "4 of 5", never "1 missed" — the same fact, and only one of the two
    // wordings is an accusation (`product-copy` §3).
    expect(screen.getByText(/4 of 5 sessions/)).toBeTruthy();
    expect(screen.queryByText(/missed/i)).toBeNull();
  });

  it('never renders a brand-new client as failing', () => {
    render(
      <ClientRow
        client={makeClient({
          trainingAdherence: null,
          nutritionAdherence: null,
          overallAdherence: null,
          adherenceColor: 'grey',
          sessionsScheduled7d: 0,
          sessionsCompleted7d: 0,
          lastActiveAt: null,
          unreadMessages: 0,
        })}
        onPress={jest.fn()}
      />,
    );

    // "Not started", not "off plan" — a client who has not begun has not
    // failed at anything (`ui-conventions` §2).
    expect(
      screen.getByLabelText(
        'Priya Sharma. Training not started, nutrition not started. No sessions scheduled, not active yet.',
      ),
    ).toBeTruthy();
  });

  it('folds the unread count into the row label, and omits it at zero', () => {
    const { rerender } = render(
      <ClientRow client={makeClient({ unreadMessages: 1 })} onPress={jest.fn()} />,
    );
    expect(screen.getByLabelText(/1 unread message\.$/)).toBeTruthy();

    rerender(<ClientRow client={makeClient({ unreadMessages: 0 })} onPress={jest.fn()} />);
    expect(screen.queryByLabelText(/unread/)).toBeNull();
  });

  it('hands the client id back on press, never a closure over the row', () => {
    const onPress = jest.fn<void, [string]>();
    const client = makeClient();
    render(<ClientRow client={client} onPress={onPress} />);

    fireEvent.press(screen.getByLabelText(/^Priya Sharma\./));

    expect(onPress).toHaveBeenCalledWith(client.clientId);
  });

  it('keeps the exported row height in step with the type scale', () => {
    // The row's own `minHeight` (FlashList v2 takes no size prop). Derived from
    // `fontSize` rather than written down, so a change to the type scale
    // moves it instead of silently invalidating it (`CLAUDE.md` §25.8).
    // 11 + 20 (name) + 3 + 15 (meta) + 11 + 1 divider.
    expect(CLIENT_ROW_HEIGHT).toBe(61);
  });
});
