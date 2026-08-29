import { readFileSync } from 'node:fs';
import path from 'node:path';

import * as barrel from '../index.ts';

// The authoritative CLAUDE.md §6.1 top-level router list, minus `health`
// (it takes no input, so it has no schema module). Hardcoded rather than
// read from apps/api/src/routers/ — §6.1 is the shared spec both features
// independently derive from, not one importing the other's directory.
const ROUTERS = [
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

  it('imports nothing but zod and ./primitives in any module — no @coachos/db, no apps/*, no Node builtin', () => {
    const importLine = /^import\s.*?from\s+['"]([^'"]+)['"];?\s*$/gm;
    for (const name of [...ROUTERS, 'primitives']) {
      const source = readFileSync(path.join(SRC_DIR, `${name}.ts`), 'utf8');
      for (const match of source.matchAll(importLine)) {
        const specifier = match[1];
        expect(specifier === 'zod' || specifier === './primitives.ts').toBe(true);
      }
    }
  });
});
