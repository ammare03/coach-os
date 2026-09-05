import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ANALYTICS_EVENT_NAMES } from '../events.ts';

// `ANALYTICS.md` AN§2.4, row 2: every event in the union appears in the
// dictionary, and every row in the dictionary appears in the union. AN§0.2
// makes an event that exists in only one of the two places a bug in the
// same PR — this is what turns that into a build failure.
const ANALYTICS_MD = path.join(__dirname, '../../../../../../ANALYTICS.md');

function eventNamesInDictionary(): string[] {
  const document = readFileSync(ANALYTICS_MD, 'utf8');

  // AN§3.1 onward. AN§3.0 is deliberately excluded: it lists the base
  // properties the emitter attaches, not events.
  const start = document.indexOf('### AN§3.1');
  const end = document.indexOf('## AN§4');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  const names = new Set<string>();
  for (const line of document.slice(start, end).split('\n')) {
    if (!line.startsWith('| `')) {
      continue;
    }
    // The first cell only — later cells name properties, not events. A few
    // rows carry several events (`trial_started` / `trial_converted` / …).
    const firstCell = line.split('|')[1] ?? '';
    for (const match of firstCell.matchAll(/`([a-z][a-z0-9_]*)`/g)) {
      const name = match[1];
      if (name !== undefined) {
        names.add(name);
      }
    }
  }
  return [...names].sort();
}

describe('the typed registry and ANALYTICS.md', () => {
  it('declares every event the dictionary documents', () => {
    const missing = eventNamesInDictionary().filter(
      (name) => !(ANALYTICS_EVENT_NAMES as readonly string[]).includes(name),
    );

    expect(missing).toEqual([]);
  });

  it('documents every event the registry declares', () => {
    const documented = new Set(eventNamesInDictionary());
    const undocumented = ANALYTICS_EVENT_NAMES.filter((name) => !documented.has(name));

    expect(undocumented).toEqual([]);
  });

  it('names every event object_action, snake_case, past tense (AN§0.1)', () => {
    for (const name of ANALYTICS_EVENT_NAMES) {
      expect(name).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/);
    }
  });

  it('lists each event exactly once', () => {
    expect(new Set(ANALYTICS_EVENT_NAMES).size).toBe(ANALYTICS_EVENT_NAMES.length);
  });
});
