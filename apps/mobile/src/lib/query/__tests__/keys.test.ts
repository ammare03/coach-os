import { calendarDate } from '@coachos/schemas';

import { keys, QUERY_KEY_ROOTS } from '../keys.ts';

// providers-and-gates/02's first acceptance criterion: the factory produces
// the exact shapes the `code-conventions` skill §5 fixes (the list
// `CLAUDE.md` §10.1 used to carry). Asserting the literal arrays is the
// point — a key that "looks right" but has an extra segment is a second
// cache entry that no invalidation elsewhere will ever reach, and nothing
// about that failure is visible at runtime.

const CLIENT_ID = '0199a1f0-0000-7000-8000-000000000001';
const SESSION_ID = '0199a1f0-0000-7000-8000-000000000002';
const ASSET_ID = '0199a1f0-0000-7000-8000-000000000003';

describe('the query key factory', () => {
  it("produces §5's client key shapes", () => {
    expect(keys.clients.list()).toEqual(['clients']);
    expect(keys.clients.detail(CLIENT_ID)).toEqual(['clients', CLIENT_ID]);
    expect(keys.clients.sessions(CLIENT_ID, { page: 2 })).toEqual([
      'clients',
      CLIENT_ID,
      'sessions',
      { page: 2 },
    ]);
  });

  it("produces §5's session, nutrition, comment and media key shapes", () => {
    expect(keys.sessions.detail(SESSION_ID)).toEqual(['sessions', SESSION_ID]);
    expect(keys.nutrition.diary(CLIENT_ID, calendarDate.parse('2026-08-15'))).toEqual([
      'nutrition',
      CLIENT_ID,
      'diary',
      '2026-08-15',
    ]);
    expect(keys.comments.list('media_asset', ASSET_ID)).toEqual([
      'comments',
      'media_asset',
      ASSET_ID,
    ]);
    expect(keys.media.detail(ASSET_ID)).toEqual(['media', ASSET_ID]);
  });

  it('makes each detail key a prefix-extension of its namespace', () => {
    // This is the property narrow invalidation depends on: invalidating
    // `['clients']` must reach `['clients', id, 'sessions', …]`, and it only
    // does if every key in the namespace starts with the same segments.
    expect(keys.clients.detail(CLIENT_ID).slice(0, 1)).toEqual([...keys.clients.list()]);
    expect(keys.clients.sessions(CLIENT_ID, { page: 1 }).slice(0, 2)).toEqual([
      ...keys.clients.detail(CLIENT_ID),
    ]);
    expect(keys.sessions.detail(SESSION_ID).slice(0, 1)).toEqual([...keys.sessions.prefix()]);
    expect(keys.media.detail(ASSET_ID).slice(0, 1)).toEqual([...keys.media.prefix()]);
  });

  it('returns a fresh array each call, so a caller cannot mutate the factory', () => {
    expect(keys.clients.list()).not.toBe(keys.clients.list());
  });

  it('lists every namespace root in QUERY_KEY_ROOTS', () => {
    // `persister.ts` filters on these; a namespace added above and forgotten
    // here is a namespace whose persistence policy nobody decided.
    const rootsFromFactory = [
      keys.clients.list()[0],
      keys.sessions.prefix()[0],
      keys.nutrition.prefix()[0],
      keys.comments.prefix()[0],
      keys.media.prefix()[0],
    ];

    expect([...QUERY_KEY_ROOTS].sort()).toEqual(rootsFromFactory.sort());
  });
});
