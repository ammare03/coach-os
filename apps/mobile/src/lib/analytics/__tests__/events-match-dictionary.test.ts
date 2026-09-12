import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { ANALYTICS_EVENT_DICTIONARY, ANALYTICS_EVENTS_NOT_YET_EMITTED } from '../dictionary.ts';
import { ANALYTICS_EVENT_NAMES } from '../events.ts';

// `ANALYTICS.md` AN§2.4, row 2: every event in the union appears in the
// dictionary, and every row in the dictionary appears in the union. AN§0.2
// makes an event that exists in only one of the two places a bug in the same
// PR — this is what turns that into a build failure.
//
// **The dictionary these read is `../dictionary.ts`, which is tracked.** This
// file used to read `ANALYTICS.md` and skip itself when the document was
// absent; `.gitignore` keeps that document out of the repository, so the
// cross-checks never ran on CI at all (UNFORGET **A4**). Nothing below is
// conditional, and no required source is optional: a missing one fails.

const SRC_ROOT = path.join(__dirname, '../../..');
const REPO_ROOT = path.join(__dirname, '../../../../../..');
const ANALYTICS_MD = path.join(REPO_ROOT, 'ANALYTICS.md');

const DICTIONARY_EVENT_NAMES = Object.keys(ANALYTICS_EVENT_DICTIONARY).sort();

// The emitter's own folder is excluded because it does not emit — it defines
// `trackEvent`, and its doc comment carries a worked example that is not a
// call site. Tests and mocks are excluded for the same reason: a fixture
// name is not evidence that the app emits anything.
const SKIPPED_DIRECTORIES = new Set(['__tests__', '__mocks__', 'node_modules']);
const EMITTER_DIRECTORY = path.join(SRC_ROOT, 'lib', 'analytics');

const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name) || full === EMITTER_DIRECTORY) {
        continue;
      }
      found.push(...sourceFiles(full));
      continue;
    }
    if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
      found.push(full);
    }
  }
  return found;
}

/** Every event name the app actually passes to `trackEvent`, by static scan. */
function emittedEventNames(): { names: string[]; filesScanned: number } {
  const names = new Set<string>();
  const files = sourceFiles(SRC_ROOT);

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\btrackEvent\(\s*['"]([A-Za-z0-9_]+)['"]/g)) {
      const name = match[1];
      if (name !== undefined) {
        names.add(name);
      }
    }
  }

  return { names: [...names].sort(), filesScanned: files.length };
}

describe('the typed registry and the tracked dictionary', () => {
  it('declares every event the dictionary documents', () => {
    const missing = DICTIONARY_EVENT_NAMES.filter(
      (name) => !(ANALYTICS_EVENT_NAMES as readonly string[]).includes(name),
    );

    expect(missing).toEqual([]);
  });

  it('documents every event the registry declares', () => {
    const documented = new Set(DICTIONARY_EVENT_NAMES);
    const undocumented = ANALYTICS_EVENT_NAMES.filter((name) => !documented.has(name));

    expect(undocumented).toEqual([]);
  });

  it('names every declared property snake_case (AN§0.1)', () => {
    for (const properties of Object.values(ANALYTICS_EVENT_DICTIONARY)) {
      for (const property of properties as readonly string[]) {
        expect(property).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
      }
    }
  });
});

describe('the tracked dictionary and the emitting code', () => {
  // A broken walker that finds nothing would make every assertion below
  // vacuous — which is the exact failure this whole file exists to end.
  it('finds the app source to scan', () => {
    const { names, filesScanned } = emittedEventNames();

    expect(filesScanned).toBeGreaterThan(50);
    expect(names.length).toBeGreaterThan(0);
  });

  it('documents every event the app emits', () => {
    const documented = new Set(DICTIONARY_EVENT_NAMES);
    const undocumented = emittedEventNames().names.filter((name) => !documented.has(name));

    expect(undocumented).toEqual([]);
  });

  it('accounts for every documented event as emitted or not yet built', () => {
    const emitted = new Set(emittedEventNames().names);
    const pending = new Set<string>(ANALYTICS_EVENTS_NOT_YET_EMITTED);
    const unaccounted = DICTIONARY_EVENT_NAMES.filter(
      (name) => !emitted.has(name) && !pending.has(name),
    );

    expect(unaccounted).toEqual([]);
  });

  it('keeps the not-yet-emitted list free of events that are emitted', () => {
    const emitted = new Set(emittedEventNames().names);
    const stale = ANALYTICS_EVENTS_NOT_YET_EMITTED.filter((name) => emitted.has(name));

    expect(stale).toEqual([]);
  });
});

// Asserted against the union alone, so these run everywhere.
describe('the typed registry', () => {
  it('names every event object_action, snake_case, past tense (AN§0.1)', () => {
    for (const name of ANALYTICS_EVENT_NAMES) {
      expect(name).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/);
    }
  });

  it('lists each event exactly once', () => {
    expect(new Set(ANALYTICS_EVENT_NAMES).size).toBe(ANALYTICS_EVENT_NAMES.length);
  });
});

// ---------------------------------------------------------------------------
// Supplementary, local-only. Additive to everything above and never the only
// assertion: `ANALYTICS.md` is gitignored by decision, so it is absent on CI
// and this block does not run there. `dictionary.ts` is the tracked source of
// truth; this only catches the machine that holds the prose document editing
// it out of step with the transcription, at the moment that happens.
// ---------------------------------------------------------------------------

function eventNamesInProseDictionary(): string[] {
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

const describeAgainstProse = existsSync(ANALYTICS_MD) ? describe : describe.skip;

describeAgainstProse('the tracked dictionary and ANALYTICS.md (local only)', () => {
  it('transcribes exactly the events the prose dictionary lists', () => {
    expect(eventNamesInProseDictionary()).toEqual(DICTIONARY_EVENT_NAMES);
  });
});
