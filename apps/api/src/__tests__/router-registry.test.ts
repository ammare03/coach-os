import { readdirSync } from 'node:fs';
import path from 'node:path';

import { appRouter } from '../routers/index.ts';

const ROUTERS_DIR = path.join(__dirname, '..', 'routers');

// Reads the directory rather than a hardcoded list — asserting against a
// fixed list proves nothing about whether the directory read actually
// works. See this task's Verification: add an unregistered scratch file,
// confirm this test fails, then delete it.
function routerFileNames(): string[] {
  return readdirSync(ROUTERS_DIR)
    .filter((file) => file.endsWith('.ts') && file !== 'index.ts')
    .map((file) => file.replace(/\.ts$/, ''));
}

describe('router registry', () => {
  it('registers every file in routers/ (other than index.ts) as a top-level appRouter key', () => {
    const registeredKeys = Object.keys(appRouter._def.record);
    for (const name of routerFileNames()) {
      expect(registeredKeys).toContain(name);
    }
  });

  it('lists top-level keys alphabetically after health', () => {
    const [first, ...rest] = Object.keys(appRouter._def.record);
    expect(first).toBe('health');
    expect(rest).toEqual([...rest].sort());
  });

  it('reaches a two-level path via a reflective walk (coach.clients.list)', () => {
    const paths = Object.keys(appRouter._def.procedures);
    expect(paths).toContain('coach.clients.list');
  });
});
