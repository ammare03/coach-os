import { fireEvent, render, screen } from '@testing-library/react-native';

import type { CoachDashboardClient } from '../../hooks/useCoachDashboard.ts';
import { CLIENT_ROW_HEIGHT, ClientRow } from '../ClientRow.tsx';

// `2026-09-12T10:00:00Z` minus two hours, so `formatRelativeToNow` has a
// fixed answer rather than one that drifts with the clock.
const NOW = new Date('2026-09-12T10:00:00.000Z');

/** The status chip is out of the reading order by design — see the row's own note. */
const HIDDEN = { includeHiddenElements: true } as const;

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
    pausedAt: null,
    archivedAt: null,
    coachSince: null,
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

  describe('a client who is not currently being coached', () => {
    it('marks a paused client with a chip in the row furniture', () => {
      render(<ClientRow client={makeClient({ status: 'paused' })} onPress={jest.fn()} />);

      // `includeHiddenElements` because the chip is deliberately out of the
      // reading order — it is visible furniture whose words the row's own
      // label already speaks.
      expect(screen.getByText('Paused', HIDDEN)).toBeTruthy();
    });

    it('marks an archived client the same way, and an active one not at all', () => {
      const { rerender } = render(
        <ClientRow client={makeClient({ status: 'archived' })} onPress={jest.fn()} />,
      );
      expect(screen.getByText('Archived', HIDDEN)).toBeTruthy();

      rerender(<ClientRow client={makeClient({ status: 'active' })} onPress={jest.fn()} />);
      expect(screen.queryByText('Archived', HIDDEN)).toBeNull();
      expect(screen.queryByText('Paused', HIDDEN)).toBeNull();
    });

    it('says the status in the row label, and the chip is not a second focus stop', () => {
      render(<ClientRow client={makeClient({ status: 'paused' })} onPress={jest.fn()} />);

      // One sentence per client, still — a coach scrolling a hundred rows
      // with VoiceOver must not hear two stops for one person.
      expect(screen.getByLabelText(/^Priya Sharma\. Paused\./)).toBeTruthy();
      expect(screen.queryByLabelText(/^Paused$/)).toBeNull();
    });

    it('draws the adherence dots as no-data, never as off plan', () => {
      // Nothing was scheduled while they were paused, so there is no score
      // to report — grey, never red (`DESIGN.md` §10.5). Forced rather than
      // trusted: a stale 40% on an archived row would render that person as
      // failing at something they were not asked to do.
      render(
        <ClientRow
          client={makeClient({ status: 'paused', trainingAdherence: 40, nutritionAdherence: 30 })}
          onPress={jest.fn()}
        />,
      );

      expect(screen.getByLabelText(/Training not started, nutrition not started/)).toBeTruthy();
    });

    it('leads the meta line with the dated status, not with a paused week\u2019s sessions', () => {
      // "4 of 5 sessions" on a paused client is a fact about the week
      // BEFORE they were paused, and reading it beside a Paused chip
      // invites a coach to draw a conclusion from it. The date is what
      // explains the row (the approved design, panel I).
      render(
        <ClientRow
          client={makeClient({
            status: 'paused',
            pausedAt: new Date('2026-09-11T09:00:00.000Z'),
          })}
          onPress={jest.fn()}
          timeZone="Asia/Kolkata"
        />,
      );

      expect(screen.getByText('Paused 11 Sep \u00b7 active about 2 hours ago')).toBeTruthy();
      expect(screen.queryByText(/4 of 5 sessions/)).toBeNull();
    });

    it('keeps the bare word when the payload carries no timestamp', () => {
      // `paused_at` is nullable and a row is never given a date it does not
      // have — the undated form is a real state, not a fallback bug.
      render(<ClientRow client={makeClient({ status: 'paused' })} onPress={jest.fn()} />);

      expect(screen.getByText('Paused \u00b7 active about 2 hours ago')).toBeTruthy();
    });

    it('speaks the date in full, and says the status exactly once', () => {
      render(
        <ClientRow
          client={makeClient({
            status: 'paused',
            pausedAt: new Date('2026-09-11T09:00:00.000Z'),
            unreadMessages: 0,
          })}
          onPress={jest.fn()}
          timeZone="Asia/Kolkata"
        />,
      );

      // The chip's own sentence builder, so the header and the row cannot
      // word one fact two ways \u2014 and "11 September", never the row's
      // abbreviated "11 Sep", because nothing is abbreviated to a screen
      // reader (`accessibility` \u00a72).
      expect(
        screen.getByLabelText(
          'Priya Sharma. Paused since 11 September. Training not started, nutrition not started. active about 2 hours ago.',
        ),
      ).toBeTruthy();
    });

    it('leaves the row height alone, chip or no chip', () => {
      // The 38px text block is taller than the 33px chip, so the chip never
      // sets the height — which is what lets FlashList v2 measure a uniform
      // row on first layout (`CLAUDE.md` §25.8).
      const { rerender } = render(
        <ClientRow client={makeClient({ status: 'active' })} onPress={jest.fn()} />,
      );
      const active = screen.getByLabelText(/^Priya Sharma\./).props.style;

      rerender(<ClientRow client={makeClient({ status: 'paused' })} onPress={jest.fn()} />);
      const paused = screen.getByLabelText(/^Priya Sharma\./).props.style;

      expect(JSON.stringify(paused)).toBe(JSON.stringify(active));
    });
  });

  /**
   * The list behind the Archived filter, where every row is archived.
   * Three things go and each for its own reason \u2014 see `ClientRowVariant`.
   */
  describe('the archived-only list variant', () => {
    function archived(overrides: Partial<CoachDashboardClient> = {}) {
      return makeClient({
        name: 'Dev Kulkarni',
        status: 'archived',
        archivedAt: new Date('2026-09-04T12:00:00.000Z'),
        coachSince: new Date('2025-11-12T12:00:00.000Z'),
        unreadMessages: 0,
        ...overrides,
      });
    }

    it('drops the chip, because the filter above already said it', () => {
      const { rerender } = render(
        <ClientRow client={archived()} onPress={jest.fn()} variant="archived" />,
      );
      expect(screen.queryByText('Archived', HIDDEN)).toBeNull();

      // Not a property of the status \u2014 the same client in the default
      // list, or in a list mixed with another status, still carries it.
      rerender(<ClientRow client={archived()} onPress={jest.fn()} variant="roster" />);
      expect(screen.getByText('Archived', HIDDEN)).toBeTruthy();
    });

    it('drops the adherence lane rather than drawing eleven no-data rings', () => {
      const { rerender } = render(
        <ClientRow client={archived()} onPress={jest.fn()} variant="archived" />,
      );
      // The lane's two letters are its only text; absent means absent, not
      // dimmed (`ClientRowVariant`, the approved design's panel J).
      expect(screen.queryByText('T', HIDDEN)).toBeNull();
      expect(screen.queryByText('N', HIDDEN)).toBeNull();

      rerender(<ClientRow client={archived()} onPress={jest.fn()} variant="roster" />);
      expect(screen.getByText('T', HIDDEN)).toBeTruthy();
    });

    it('says when it ended and how long it ran, not how active they are now', () => {
      render(
        <ClientRow
          client={archived()}
          onPress={jest.fn()}
          variant="archived"
          timeZone="Asia/Kolkata"
        />,
      );

      expect(screen.getByText('Archived 4 Sep \u00b7 42 weeks together')).toBeTruthy();
      // "active 2 hours ago" on a finished relationship is a fact about
      // nothing a coach looking back can use.
      expect(screen.queryByText(/active/)).toBeNull();
    });

    it('says nothing about a duration it cannot compute', () => {
      // `coach_since` is genuinely absent for a first-ever coach (DB\u00a75.1),
      // and a made-up duration on a record is worse than a shorter line.
      render(
        <ClientRow
          client={archived({ coachSince: null })}
          onPress={jest.fn()}
          variant="archived"
          timeZone="Asia/Kolkata"
        />,
      );

      expect(screen.getByText('Archived 4 Sep')).toBeTruthy();
      expect(screen.queryByText(/weeks together/)).toBeNull();
    });

    it('never reports a relationship as lasting zero weeks', () => {
      render(
        <ClientRow
          client={archived({ coachSince: new Date('2026-09-02T12:00:00.000Z') })}
          onPress={jest.fn()}
          variant="archived"
          timeZone="Asia/Kolkata"
        />,
      );

      // Two days, floored to one week: "0 weeks together" reads as a data
      // error rather than as a short engagement.
      expect(screen.getByText('Archived 4 Sep \u00b7 1 week together')).toBeTruthy();
    });

    it('reads as one sentence with no adherence claim in it', () => {
      render(
        <ClientRow
          client={archived()}
          onPress={jest.fn()}
          variant="archived"
          timeZone="Asia/Kolkata"
        />,
      );

      expect(
        screen.getByLabelText('Dev Kulkarni. Archived on 4 September. 42 weeks together.'),
      ).toBeTruthy();
      // No lane on screen and no score in words \u2014 the two have to agree.
      expect(screen.queryByLabelText(/not started/)).toBeNull();
    });

    it('leaves the row height alone with the lane and the chip both gone', () => {
      // The 38px text block sets the height, so removing furniture beside
      // it changes nothing \u2014 which is what lets FlashList v2 measure one
      // uniform row across both variants (`CLAUDE.md` \u00a725.8).
      const { rerender } = render(
        <ClientRow client={makeClient({ status: 'active' })} onPress={jest.fn()} />,
      );
      const roster = screen.getByLabelText(/^Priya Sharma\./).props.style;

      rerender(<ClientRow client={archived()} onPress={jest.fn()} variant="archived" />);
      const archivedStyle = screen.getByLabelText(/^Dev Kulkarni\./).props.style;

      expect(JSON.stringify(archivedStyle)).toBe(JSON.stringify(roster));
    });
  });

  it('keeps the exported row height in step with the type scale', () => {
    // The row's own `minHeight` (FlashList v2 takes no size prop). Derived from
    // `fontSize` rather than written down, so a change to the type scale
    // moves it instead of silently invalidating it (`CLAUDE.md` §25.8).
    // 11 + 20 (name) + 3 + 15 (meta) + 11 + 1 divider.
    expect(CLIENT_ROW_HEIGHT).toBe(61);
  });
});
