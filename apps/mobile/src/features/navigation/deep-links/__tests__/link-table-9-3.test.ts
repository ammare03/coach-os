import { readdirSync } from 'node:fs';
import path from 'node:path';

import type { AccessTokenRole } from '../../../auth/jwt.ts';
import { LINK_TABLE, resolveDeepLink } from '../link-table.ts';
import { parseDeepLink } from '../parse.ts';

// `deep-linking/03`'s Verification section, and its Risks section in
// particular: "a link that resolves correctly for a coach but silently
// mis-routes for a client might not be caught unless BOTH role states are
// explicitly tested for EVERY role-dependent link". So every row below is
// asserted for coach, assistant, and client — not for whichever role the
// author had in mind.

function resolve(url: string, role: AccessTokenRole | null) {
  const link = parseDeepLink(url);
  expect(link).not.toBeNull();
  return resolveDeepLink(link ?? { segments: [], query: '' }, role);
}

function href(url: string, role: AccessTokenRole | null): string | null {
  const target = resolve(url, role);
  return target.status === 'resolved' ? target.href : null;
}

/** §9.3's seven links, plus UI-UX.md §UX1.4's. */
const EXPECTED_KEYS = [
  'chat',
  'checkin',
  'client',
  'invite',
  'live',
  'reset-password',
  'session',
  'video',
];

describe('the §9.3 link table', () => {
  it('answers to every §9.3 link and to nothing else', () => {
    expect(Object.keys(LINK_TABLE).sort()).toEqual(EXPECTED_KEYS);
  });

  it('resolves /invite/{code} identically for everyone, including no session', () => {
    for (const role of [null, 'coach', 'assistant', 'client'] as const) {
      expect(href('coachos://invite/ABC123', role)).toBe('/(auth)/invite/ABC123');
    }
  });

  describe.each([
    ['coach' as const, true],
    ['assistant' as const, true],
    ['client' as const, false],
  ])('as a %s', (role, isCoachSide) => {
    it('routes /client/{id} to the client overview, or nowhere', () => {
      expect(href('coachos://client/cl-1', role)).toBe(isCoachSide ? '/(coach)/client/cl-1' : null);
    });

    it('routes /video/{assetId} to the annotator or the client Coach tab', () => {
      expect(href('coachos://video/as-1', role)).toBe(
        isCoachSide ? '/(coach)/video/as-1' : '/(client)/(tabs)/coach?assetId=as-1',
      );
    });

    it('routes /session/{id} to session review or to the logger', () => {
      expect(href('coachos://session/se-1', role)).toBe(
        isCoachSide ? '/(coach)/session/se-1' : '/(client)/workout/se-1',
      );
    });

    it('routes /checkin/{id} into the caller’s own group', () => {
      expect(href('coachos://checkin/ch-1', role)).toBe(
        isCoachSide ? '/(coach)/checkin/ch-1' : '/(client)/checkin/ch-1',
      );
    });

    it('routes /live/{sessionId} into the caller’s own group', () => {
      expect(href('coachos://live/lv-1', role)).toBe(
        isCoachSide ? '/(coach)/live/lv-1' : '/(client)/live/lv-1',
      );
    });

    it('routes /chat/{conversationId} to the inbox or the Coach tab', () => {
      expect(href('coachos://chat/cv-1', role)).toBe(
        isCoachSide ? '/(coach)/(tabs)/inbox?conversationId=cv-1' : '/(client)/(tabs)/coach',
      );
    });

    it('extracts the dynamic segment rather than a fixed id', () => {
      expect(href('coachos://checkin/a-completely-different-id', role)).toContain(
        'a-completely-different-id',
      );
    });
  });

  // The three-app-states task (`04`) is what acts on this; the table's job is
  // to say "not yet" instead of guessing, for every role-dependent row.
  describe('with the session still resolving', () => {
    it.each([
      'client/cl-1',
      'video/as-1',
      'session/se-1',
      'checkin/ch-1',
      'live/lv-1',
      'chat/cv-1',
    ])('defers /%s until the role is known', (path) => {
      expect(resolve(`coachos://${path}`, null).status).toBe('needs-role');
    });

    it('never defers the two links that must work signed out', () => {
      expect(resolve('coachos://invite/ABC', null).status).toBe('resolved');
      expect(resolve('coachos://reset-password/tok', null).status).toBe('resolved');
    });
  });

  it('resolves every link identically from the universal-link form', () => {
    for (const path of [
      'invite/ABC',
      'client/cl-1',
      'video/as-1',
      'session/se-1',
      'checkin/ch-1',
      'live/lv-1',
      'chat/cv-1',
      'reset-password/tok',
    ]) {
      expect(resolve(`https://app.coachos.com/${path}`, 'coach')).toEqual(
        resolve(`coachos://${path}`, 'coach'),
      );
    }
  });

  it('merges an incoming query into a row that already carries one', () => {
    expect(href('coachos://chat/cv-1?from=push', 'coach')).toBe(
      '/(coach)/(tabs)/inbox?conversationId=cv-1&from=push',
    );
    expect(href('coachos://session/se-1?from=push', 'coach')).toBe(
      '/(coach)/session/se-1?from=push',
    );
  });

  // The single most valuable assertion in this file. Every href above is a
  // hand-written string; nothing in TypeScript checks one against the route
  // tree, and a `(coach)/checkin/…` that should have said `(client)/…`
  // typechecks perfectly and lands on `+not-found` at runtime — for one role
  // only, which is exactly the silent mis-route this task's Risks section
  // names. Matched against the files on disk rather than through a navigator
  // so it stays a table test.
  describe('every destination is a real route', () => {
    const APP_DIR = path.resolve(__dirname, '../../../../app');

    function routePatterns(directory = ''): string[] {
      const found: string[] = [];
      for (const entry of readdirSync(path.join(APP_DIR, directory), { withFileTypes: true })) {
        const relative = directory ? `${directory}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          found.push(...routePatterns(relative));
        } else if (/\.tsx$/.test(entry.name) && !entry.name.startsWith('_')) {
          found.push(relative.replace(/\.tsx$/, '').replace(/\/index$/, ''));
        }
      }
      return found;
    }

    const PATTERNS = routePatterns().map((pattern) => pattern.split('/'));

    function isRoute(href: string): boolean {
      const wanted = (href.split('?')[0] ?? '').split('/').filter((part) => part !== '');
      return PATTERNS.some(
        (pattern) =>
          pattern.length === wanted.length &&
          pattern.every((part, index) => part.startsWith('[') || part === wanted[index]),
      );
    }

    it.each([
      ['invite/ABC', null],
      ['reset-password/tok', null],
      ['client/cl-1', 'coach'],
      ['video/as-1', 'coach'],
      ['video/as-1', 'client'],
      ['session/se-1', 'coach'],
      ['session/se-1', 'client'],
      ['checkin/ch-1', 'coach'],
      ['checkin/ch-1', 'client'],
      ['live/lv-1', 'coach'],
      ['live/lv-1', 'client'],
      ['chat/cv-1', 'coach'],
      ['chat/cv-1', 'client'],
    ] as const)('/%s as %s', (linkPath, role) => {
      const target = href(`coachos://${linkPath}`, role);
      expect(target).not.toBeNull();
      expect({ href: target, exists: isRoute(target ?? '') }).toEqual({
        href: target,
        exists: true,
      });
    });

    it('is checking against a tree it actually found', () => {
      expect(PATTERNS.length).toBeGreaterThan(20);
    });
  });
});
