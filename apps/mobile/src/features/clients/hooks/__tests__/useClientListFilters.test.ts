import { act, renderHook } from '@testing-library/react-native';

import type { DashboardCounterKey } from '../../components/DashboardCounters.tsx';
import type { CoachDashboardClient } from '../../hooks/useCoachDashboard.ts';
import { resetClientListPreferencesForTests } from '../../store/client-list-preferences.ts';
import {
  CLIENT_SORTS,
  countStatusUniverse,
  COUNTER_FILTERS,
  DEFAULT_CLIENT_SORT,
  FILTERABLE_STATUSES,
  isArchivedOnly,
  isCounterFilterable,
  SEARCH_DEBOUNCE_MS,
  selectClients,
  useClientListFilters,
  type ClientListSelection,
} from '../useClientListFilters.ts';

// `coach-dashboard/02`'s whole contract is this one pure function, so it
// gets the thorough suite `testing` §3 asks of derived logic: every sort,
// every tie-break, search narrowing, and the AND across the two facets.
//
// The task's Verification section asks for a seeded 30-client roster
// spanning every status and goal. `roster()` below IS that fixture — every
// value of `client_status` the dashboard can return and every value of
// `training_goal`, plus the null goal a client who has not answered yet
// carries. Exercised here rather than against a live seeded database, which
// no unit test can reach.

function client(
  name: string,
  overrides: Partial<CoachDashboardClient> = {},
  id = name.toLowerCase().replaceAll(/[^a-z]/g, ''),
): CoachDashboardClient {
  return {
    clientId: id,
    name,
    status: 'active',
    goal: 'fat_loss',
    avatarAssetId: null,
    unreadMessages: 0,
    lastActiveAt: new Date('2026-09-10T08:00:00.000Z'),
    sessionsCompleted7d: 4,
    sessionsScheduled7d: 5,
    unreviewedSessions: 0,
    unreviewedVideos: 0,
    latestWeightKg: 70,
    trainingAdherence: 80,
    nutritionAdherence: 90,
    overallAdherence: 84,
    adherenceColor: 'amber',
    pausedAt: null,
    archivedAt: null,
    coachSince: null,
    ...overrides,
  } as CoachDashboardClient;
}

const BASE: ClientListSelection = {
  sort: DEFAULT_CLIENT_SORT,
  query: '',
  statuses: [],
  goals: [],
  counter: null,
};

function names(clients: readonly CoachDashboardClient[]): string[] {
  return clients.map((entry) => entry.name);
}

describe('selectClients — the attention-needed sort', () => {
  it('is the default sort', () => {
    expect(DEFAULT_CLIENT_SORT).toBe('attention');
  });

  it('puts every client waiting on the coach above every client who is not', () => {
    const waiting = client('Waiting', { unreviewedVideos: 1, overallAdherence: 99 });
    const perfect = client('Perfect', { overallAdherence: 10 });

    expect(names(selectClients([perfect, waiting], BASE))).toEqual(['Waiting', 'Perfect']);
  });

  it('ranks waiting on the boolean, not the volume, so a prolific client cannot camp at the top', () => {
    const many = client('Many', { unreviewedSessions: 8, overallAdherence: 90 });
    const one = client('One', { unreviewedVideos: 1, overallAdherence: 20 });

    // Eight unreviewed items and one are both "waiting on you"; inside that
    // group it is adherence that decides, and One is the client in trouble.
    expect(names(selectClients([many, one], BASE))).toEqual(['One', 'Many']);
  });

  it('then ranks lowest overall adherence first', () => {
    const rows = [
      client('High', { overallAdherence: 90 }),
      client('Low', { overallAdherence: 20 }),
      client('Mid', { overallAdherence: 55 }),
    ];

    expect(names(selectClients(rows, BASE))).toEqual(['Low', 'Mid', 'High']);
  });

  it('never lets a client with no data outrank one measurably off plan', () => {
    const noData = client('No data', { overallAdherence: null });
    const offPlan = client('Off plan', { overallAdherence: 12 });
    const onPlan = client('On plan', { overallAdherence: 95 });

    expect(names(selectClients([noData, onPlan, offPlan], BASE))).toEqual([
      'Off plan',
      'On plan',
      'No data',
    ]);
  });

  it('then ranks longest since last activity first, with never-active last', () => {
    const rows = [
      client('Never', { overallAdherence: 50, lastActiveAt: null }),
      client('Recent', { overallAdherence: 50, lastActiveAt: new Date('2026-09-12T08:00:00Z') }),
      client('Stale', { overallAdherence: 50, lastActiveAt: new Date('2026-09-01T08:00:00Z') }),
    ];

    expect(names(selectClients(rows, BASE))).toEqual(['Stale', 'Recent', 'Never']);
  });

  it('breaks a total tie by name, then by id, so the order cannot shuffle between refreshes', () => {
    const shared = { overallAdherence: 50, lastActiveAt: null };
    const a = client('Same name', shared, 'id-a');
    const b = client('Same name', shared, 'id-b');
    const c = client('Another', shared, 'id-c');

    const forwards = selectClients([a, b, c], BASE).map((entry) => entry.clientId);
    const backwards = selectClients([c, b, a], BASE).map((entry) => entry.clientId);

    expect(forwards).toEqual(['id-c', 'id-a', 'id-b']);
    expect(backwards).toEqual(forwards);
  });

  it('leaves the caller’s array untouched', () => {
    const rows = [client('B', { overallAdherence: 90 }), client('A', { overallAdherence: 10 })];
    const snapshot = names(rows);

    selectClients(rows, BASE);

    expect(names(rows)).toEqual(snapshot);
  });
});

describe('selectClients — name and last-active sorts', () => {
  it('sorts by name A–Z, case-insensitively', () => {
    const rows = [client('zara'), client('Adrian'), client('mia')];

    expect(names(selectClients(rows, { ...BASE, sort: 'name' }))).toEqual([
      'Adrian',
      'mia',
      'zara',
    ]);
  });

  it('sorts last-active most recent first, with never-active last', () => {
    const rows = [
      client('Old', { lastActiveAt: new Date('2026-08-01T00:00:00Z') }),
      client('Never', { lastActiveAt: null }),
      client('New', { lastActiveAt: new Date('2026-09-12T00:00:00Z') }),
    ];

    expect(names(selectClients(rows, { ...BASE, sort: 'last-active' }))).toEqual([
      'New',
      'Old',
      'Never',
    ]);
  });

  it('breaks a last-active tie by name so two never-active clients hold a stable order', () => {
    const rows = [client('Bea', { lastActiveAt: null }), client('Ana', { lastActiveAt: null })];

    expect(names(selectClients(rows, { ...BASE, sort: 'last-active' }))).toEqual(['Ana', 'Bea']);
  });
});

describe('selectClients — search', () => {
  const rows = [client('Priya Sharma'), client('Dev Kulkarni'), client('Aditi Menon')];

  it('matches a case-insensitive substring anywhere in the name', () => {
    expect(names(selectClients(rows, { ...BASE, query: 'SHAR' }))).toEqual(['Priya Sharma']);
    expect(names(selectClients(rows, { ...BASE, query: 'men' }))).toEqual(['Aditi Menon']);
  });

  it('ignores surrounding whitespace and returns everything for an empty query', () => {
    expect(names(selectClients(rows, { ...BASE, query: '   ' }))).toHaveLength(3);
    expect(names(selectClients(rows, { ...BASE, query: '  dev ' }))).toEqual(['Dev Kulkarni']);
  });

  it('returns an empty array rather than falling back to the whole roster', () => {
    expect(selectClients(rows, { ...BASE, query: 'zzz' })).toEqual([]);
  });

  it('narrows within the chosen sort rather than replacing it', () => {
    const scored = [
      client('Sana Nair', { overallAdherence: 90 }),
      client('Sana Rao', { overallAdherence: 20 }),
      client('Dev Kulkarni', { overallAdherence: 10 }),
    ];

    expect(names(selectClients(scored, { ...BASE, query: 'sana' }))).toEqual([
      'Sana Rao',
      'Sana Nair',
    ]);
  });
});

describe('selectClients — status and goal filters', () => {
  // The Verification fixture: every status the dashboard returns, every
  // training goal, and the null goal an un-onboarded client carries.
  function roster(): CoachDashboardClient[] {
    const statuses = FILTERABLE_STATUSES;
    const goals = ['fat_loss', 'muscle_gain', 'performance', 'health', 'other', null] as const;
    return statuses.flatMap((status) =>
      goals.map((goal, index) =>
        client(`${status}-${goal ?? 'none'}`, { status, goal }, `${status}-${String(index)}`),
      ),
    );
  }

  it('returns the roster minus the archived when no chip is on', () => {
    // `archived` is EXCLUDED by default rather than merely unselected
    // (`relationship-controls/01`): an archived client is bookkeeping, not
    // this week's work, and eleven of them at the top of a roster is a
    // dashboard that lies about how many clients a coach has.
    const result = selectClients(roster(), BASE);

    expect(result).toHaveLength(18);
    expect(result.some((entry) => entry.status === 'archived')).toBe(false);
    expect(result.some((entry) => entry.status === 'paused')).toBe(true);
  });

  it('shows the archived only when the chip asks for them', () => {
    const result = selectClients(roster(), { ...BASE, statuses: ['archived'] });

    expect(result).toHaveLength(6);
    expect(result.every((entry) => entry.status === 'archived')).toBe(true);
  });

  it('keeps the default exclusion out of the way of an explicit selection', () => {
    const result = selectClients(roster(), { ...BASE, statuses: ['active', 'archived'] });

    expect(result).toHaveLength(12);
  });

  it('treats several chips within one facet as OR', () => {
    const result = selectClients(roster(), { ...BASE, goals: ['fat_loss', 'health'] });

    // Two goals across the three statuses a default roster shows — the
    // archived pair is out for the reason the first case in this block
    // states, not because of the goal filter.
    expect(result).toHaveLength(6);
    expect(result.every((entry) => entry.goal === 'fat_loss' || entry.goal === 'health')).toBe(
      true,
    );
  });

  it('combines status and goal as AND, never OR', () => {
    const result = selectClients(roster(), {
      ...BASE,
      statuses: ['invited'],
      goals: ['muscle_gain'],
    });

    expect(names(result)).toEqual(['invited-muscle_gain']);
  });

  it('excludes a client whose goal is unset from every goal filter', () => {
    const result = selectClients(roster(), { ...BASE, goals: ['other'] });

    expect(names(result).sort()).toEqual(['active-other', 'invited-other', 'paused-other']);
  });

  it('keeps a client whose goal is unset when only status is filtered', () => {
    const result = selectClients(roster(), { ...BASE, statuses: ['active'] });

    expect(result).toHaveLength(6);
    expect(result.some((entry) => entry.goal === null)).toBe(true);
  });
});

describe('selectClients — the counter filter', () => {
  const rows = [
    client('Unreviewed', { unreviewedSessions: 2, adherenceColor: 'green' }),
    client('Unreviewed video', { unreviewedVideos: 1, adherenceColor: 'green' }),
    client('Off plan', { adherenceColor: 'red' }),
    client('Fine', { adherenceColor: 'green' }),
  ];

  it('narrows to the clients the Needs-review counter counted', () => {
    const result = selectClients(rows, { ...BASE, counter: 'needsReview' });

    expect(names(result).sort()).toEqual(['Unreviewed', 'Unreviewed video']);
  });

  it('narrows to the clients whose dot reads Off plan', () => {
    expect(names(selectClients(rows, { ...BASE, counter: 'offPlan' }))).toEqual(['Off plan']);
  });

  it('combines with the facets as AND', () => {
    const mixed = [
      client('Both', { adherenceColor: 'red', status: 'invited' }),
      client('Only red', { adherenceColor: 'red', status: 'active' }),
    ];

    expect(
      names(selectClients(mixed, { ...BASE, counter: 'offPlan', statuses: ['invited'] })),
    ).toEqual(['Both']);
  });

  // The dashboard payload carries no per-client pending-check-in signal, so
  // this counter is a read-only stat rather than a filter. Pinned as a test
  // so a later phase that adds the column has to delete this expectation
  // deliberately rather than discover the gap.
  it('reports Check-ins due as not filterable, and leaves the roster whole if asked anyway', () => {
    expect(isCounterFilterable('needsReview')).toBe(true);
    expect(isCounterFilterable('offPlan')).toBe(true);
    expect(isCounterFilterable('checkinsDue')).toBe(false);

    expect(selectClients(rows, { ...BASE, counter: 'checkinsDue' })).toHaveLength(rows.length);
  });

  it('has an entry for every counter the dashboard renders', () => {
    const keys: DashboardCounterKey[] = ['needsReview', 'offPlan', 'checkinsDue'];

    expect(Object.keys(COUNTER_FILTERS).sort()).toEqual([...keys].sort());
  });

  // **The counter and the list it opens have to agree.** The number above
  // is `COACHED_STATUSES`-guarded on the server (`CLAUDE.md` §15.5), so a
  // coach tapping "Off plan · 3" must not land on a fourth row — one whose
  // own adherence dots `ClientRow` deliberately draws grey.
  it('never lists a paused or archived client under the Off-plan counter', () => {
    const mixed = [
      client('Active red', { adherenceColor: 'red', status: 'active' }, 'a'),
      client('Invited red', { adherenceColor: 'red', status: 'invited' }, 'i'),
      client('Paused red', { adherenceColor: 'red', status: 'paused' }, 'p'),
      client('Archived red', { adherenceColor: 'red', status: 'archived' }, 'z'),
    ];

    const result = selectClients(mixed, {
      ...BASE,
      counter: 'offPlan',
      // Every status asked for by name, so the exclusion under test is the
      // counter's own and not the default archived one standing in for it.
      statuses: ['active', 'invited', 'paused', 'archived'],
    });

    expect(names(result).sort()).toEqual(['Active red', 'Invited red']);
  });

  it('guards the Off-plan predicate itself, not only the list that calls it', () => {
    const offPlan = COUNTER_FILTERS.offPlan;

    expect(offPlan).not.toBeNull();
    expect(offPlan?.(client('A', { adherenceColor: 'red', status: 'active' }))).toBe(true);
    expect(offPlan?.(client('I', { adherenceColor: 'red', status: 'invited' }))).toBe(true);
    expect(offPlan?.(client('P', { adherenceColor: 'red', status: 'paused' }))).toBe(false);
    expect(offPlan?.(client('Z', { adherenceColor: 'red', status: 'archived' }))).toBe(false);
  });
});

// ── the archived list ───────────────────────────────────────────────────

describe('selectClients — the archived list', () => {
  function archived(name: string, on: string | null, overrides = {}): CoachDashboardClient {
    return client(
      name,
      { status: 'archived', archivedAt: on === null ? null : new Date(on), ...overrides },
      name.toLowerCase(),
    );
  }

  it('recognises the archived chip alone, and never merely as part of a selection', () => {
    expect(isArchivedOnly(['archived'])).toBe(true);
    expect(isArchivedOnly([])).toBe(false);
    expect(isArchivedOnly(['active'])).toBe(false);
    expect(isArchivedOnly(['active', 'archived'])).toBe(false);
  });

  it('orders newest-archived first, whatever sort the coach last chose', () => {
    const rows = [
      archived('Older', '2026-07-30T00:00:00.000Z'),
      archived('Newest', '2026-09-04T00:00:00.000Z'),
      archived('Middle', '2026-08-21T00:00:00.000Z'),
    ];

    // Every sort in the vocabulary, because the point is that none of them
    // reaches this list: `attention` ranks by a week nobody was asked to
    // train in, and the approved design pins one order and says so in the
    // count line above the rows.
    for (const sort of CLIENT_SORTS) {
      expect(names(selectClients(rows, { ...BASE, sort, statuses: ['archived'] }))).toEqual([
        'Newest',
        'Middle',
        'Older',
      ]);
    }
  });

  it('sorts a row with no archived date last rather than first', () => {
    const rows = [archived('Undated', null), archived('Dated', '2026-06-01T00:00:00.000Z')];

    // Absence is not recency, exactly as `null` adherence is not a low
    // score — the same rule the attention ranking already applies.
    expect(names(selectClients(rows, { ...BASE, statuses: ['archived'] }))).toEqual([
      'Dated',
      'Undated',
    ]);
  });

  it('leaves the coach’s sort in force the moment the list is mixed again', () => {
    const rows = [
      archived('Bravo', '2026-09-04T00:00:00.000Z'),
      client('Alpha', { status: 'active' }, 'alpha'),
    ];

    expect(
      names(selectClients(rows, { ...BASE, sort: 'name', statuses: ['active', 'archived'] })),
    ).toEqual(['Alpha', 'Bravo']);
  });
});

describe('countStatusUniverse', () => {
  const mixed = [
    client('Active', { status: 'active' }, 'a'),
    client('Invited', { status: 'invited' }, 'i'),
    client('Paused', { status: 'paused' }, 'p'),
    client('Archived one', { status: 'archived' }, 'z1'),
    client('Archived two', { status: 'archived' }, 'z2'),
  ];

  it('counts the rows the default list can draw, which is never the archived ones', () => {
    expect(countStatusUniverse(mixed, [])).toBe(3);
  });

  it('counts only the archived when the archived chip asks for them', () => {
    expect(countStatusUniverse(mixed, ['archived'])).toBe(2);
  });

  it('follows an explicit selection exactly', () => {
    expect(countStatusUniverse(mixed, ['active', 'archived'])).toBe(3);
  });
});

// ── the hook ────────────────────────────────────────────────────────────
//
// The wiring the screen suite cannot assert: `CoachDashboardScreen` renders
// through `FlashList`, whose element tree is in recycler order rather than
// visual order, so the ORDER a sort produces is asserted here.

describe('useClientListFilters', () => {
  const roster = [
    client('Calm', { overallAdherence: 95 }, 'calm'),
    client('Waiting', { unreviewedVideos: 2, overallAdherence: 99 }, 'waiting'),
    client('Almost there', { overallAdherence: 20 }, 'almost'),
  ];

  beforeEach(() => {
    resetClientListPreferencesForTests();
  });

  it('opens on the documented attention order', () => {
    const { result } = renderHook(() => useClientListFilters(roster));

    expect(result.current.sort).toBe(DEFAULT_CLIENT_SORT);
    expect(names(result.current.clients)).toEqual(['Waiting', 'Almost there', 'Calm']);
    expect(result.current.isNarrowed).toBe(false);
  });

  it('re-orders on a sort change, from the same input array', () => {
    const { result } = renderHook(() => useClientListFilters(roster));

    act(() => {
      result.current.setSort('name');
    });

    expect(names(result.current.clients)).toEqual(['Almost there', 'Calm', 'Waiting']);
  });

  it('echoes a keystroke immediately and narrows once typing settles', () => {
    jest.useFakeTimers();
    try {
      const { result } = renderHook(() => useClientListFilters(roster));

      act(() => {
        result.current.setQuery('calm');
      });

      // The field is never the thing that waits.
      expect(result.current.draftQuery).toBe('calm');
      expect(result.current.clients).toHaveLength(3);

      act(() => {
        jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      });

      expect(names(result.current.clients)).toEqual(['Calm']);
      expect(result.current.isNarrowed).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('selects a counter and clears it on a second tap', () => {
    const { result } = renderHook(() => useClientListFilters(roster));

    act(() => {
      result.current.selectCounter('needsReview');
    });
    expect(result.current.counter).toBe('needsReview');
    expect(names(result.current.clients)).toEqual(['Waiting']);

    act(() => {
      result.current.selectCounter('needsReview');
    });
    expect(result.current.counter).toBeNull();
    expect(result.current.clients).toHaveLength(3);
  });

  it('never lets a counter with no predicate claim to be selected', () => {
    const { result } = renderHook(() => useClientListFilters(roster));

    act(() => {
      result.current.selectCounter('checkinsDue');
    });

    expect(result.current.counter).toBeNull();
    expect(result.current.clients).toHaveLength(3);
  });

  it('clears the query, the counter, and the chips — and leaves the sort alone', () => {
    const { result } = renderHook(() => useClientListFilters(roster));

    act(() => {
      result.current.setSort('name');
      result.current.setQuery('zzz');
      result.current.selectCounter('offPlan');
      result.current.toggleStatus('invited');
      result.current.toggleGoal('health');
    });

    act(() => {
      result.current.clearAll();
    });

    expect(result.current.draftQuery).toBe('');
    expect(result.current.counter).toBeNull();
    expect(result.current.statuses).toEqual([]);
    expect(result.current.goals).toEqual([]);
    expect(result.current.activeFilterCount).toBe(0);
    // A sort is a preference, not a narrowing — "clear" has nothing to undo.
    expect(result.current.sort).toBe('name');
  });

  // ── the count line's denominator ──────────────────────────────────────
  //
  // "24 of 38 clients" on a roster where 11 of the 38 are archived is a
  // denominator counting rows that list can never draw. The universe is
  // whatever the STATUS facet admits — status decides membership, the query
  // and the goal chips narrow within it.

  describe('totalCount', () => {
    const mixed = [
      client('Active', { status: 'active' }, 'a'),
      client('Invited', { status: 'invited' }, 'i'),
      client('Paused', { status: 'paused' }, 'p'),
      client('Archived one', { status: 'archived' }, 'z1'),
      client('Archived two', { status: 'archived' }, 'z2'),
    ];

    it('excludes the archived from the default list’s denominator', () => {
      const { result } = renderHook(() => useClientListFilters(mixed));

      expect(result.current.clients).toHaveLength(3);
      expect(result.current.totalCount).toBe(3);
    });

    it('becomes the archived count when the archived chip is the selection', () => {
      const { result } = renderHook(() => useClientListFilters(mixed));

      act(() => {
        result.current.toggleStatus('archived');
      });

      expect(result.current.totalCount).toBe(2);
    });

    it('stays the universe while a query narrows the list inside it', () => {
      jest.useFakeTimers();
      try {
        const { result } = renderHook(() => useClientListFilters(mixed));

        act(() => {
          result.current.setQuery('active');
        });
        act(() => {
          jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
        });

        expect(result.current.clients).toHaveLength(1);
        expect(result.current.totalCount).toBe(3);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  it('reports an archived-only selection, and the order that selection forces', () => {
    const archivedRoster = [
      client('Older', { status: 'archived', archivedAt: new Date('2026-07-30') }, 'old'),
      client('Newest', { status: 'archived', archivedAt: new Date('2026-09-04') }, 'new'),
    ];
    const { result } = renderHook(() => useClientListFilters(archivedRoster));

    expect(result.current.isArchivedOnly).toBe(false);

    act(() => {
      result.current.setSort('name');
      result.current.toggleStatus('archived');
    });

    expect(result.current.isArchivedOnly).toBe(true);
    // The persisted preference is untouched — it simply does not reach this
    // list, and comes back the moment the chip does.
    expect(result.current.sort).toBe('name');
    expect(names(result.current.clients)).toEqual(['Newest', 'Older']);
  });
});
