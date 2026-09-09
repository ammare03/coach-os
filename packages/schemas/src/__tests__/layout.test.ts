import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import * as barrel from '../index.ts';

// The authoritative CLAUDE.md §6.1 top-level router list, minus `health`
// (it takes no input, so it has no schema module). Hardcoded rather than
// read from apps/api/src/routers/ — §6.1 is the shared spec both features
// independently derive from, not one importing the other's directory.
const ROUTERS = [
  'assignments',
  'auth',
  'billing',
  'checkins',
  'client',
  'coach',
  'comments',
  'exercises',
  'habits',
  'invites',
  'live',
  'me',
  'media',
  'messages',
  'metrics',
  'notifications',
  'nutrition',
  'programs',
  'support',
  'workouts',
];

const SRC_DIR = path.join(__dirname, '..');

// F13: the previous version of this test walked ROUTERS (+ primitives) —
// 21 of the 27 modules directly under src/. `auth-session`, `errors`,
// `index`, `limits`, `pagination`, and `strict` were never checked, not
// because they break the rule (they don't) but because nothing enumerated
// them. Reading the directory itself closes that gap permanently: a new
// module can't add itself and skip this check the way a hand-maintained
// list let six modules do.
function schemaModuleNames(): string[] {
  return readdirSync(SRC_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => entry.name.slice(0, -'.ts'.length));
}

// The two legitimate exceptions to "zod or ./primitives.ts only" — both
// named and justified in pagination.ts's own doc comment: MAX_PAGE_SIZE/
// DEFAULT_PAGE_SIZE from limits.ts, and strictObject re-exported from
// strict.ts. Allowed explicitly, per-module, rather than loosening the
// rule for everyone.
const IMPORT_RULE_EXCEPTIONS: Readonly<Record<string, readonly string[]>> = {
  pagination: ['./limits.ts', './strict.ts'],
};

describe('module layout', () => {
  it('has a module for every §6.1 router', () => {
    for (const name of ROUTERS) {
      expect(() => readFileSync(path.join(SRC_DIR, `${name}.ts`), 'utf8')).not.toThrow();
    }
  });

  it('re-exports every router module from the barrel as a namespace', () => {
    for (const name of ROUTERS) {
      expect(barrel).toHaveProperty(name);
      expect(typeof (barrel as Record<string, unknown>)[name]).toBe('object');
    }
  });

  it('imports nothing but zod and ./primitives in any module under src/ — no @coachos/db, no apps/*, no Node builtin', () => {
    const importLine = /^import\s.*?from\s+['"]([^'"]+)['"];?\s*$/gm;
    for (const name of schemaModuleNames()) {
      const exceptions = IMPORT_RULE_EXCEPTIONS[name] ?? [];
      const source = readFileSync(path.join(SRC_DIR, `${name}.ts`), 'utf8');
      for (const match of source.matchAll(importLine)) {
        const specifier = match[1] ?? '';
        const isAllowed =
          specifier === 'zod' || specifier === './primitives.ts' || exceptions.includes(specifier);
        expect(isAllowed).toBe(true);
      }
    }
  });
});
