// `prefetch/02` Approach step 4 and its third acceptance criterion:
// `local_comments` is a read-only mirror. This prefetch fills it; nothing
// else on the device may write it, because a comment is never created
// offline — P12 creates one through the ordinary online tRPC path, never
// through the outbox (`src/db/schema/local-feedback.ts`, DB§13).
//
// A grep, deliberately, and not a runtime assertion: the property is "no
// such code exists", which nothing at runtime can observe. Same technique
// and same justification as the API's
// `server-authored-no-offline-write.test.ts`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const MOBILE_SRC = path.join(__dirname, '..', '..');

/** The one file allowed to write the table, relative to `src/`. */
const SOLE_WRITER = path.join('lib', 'prefetch', 'history.ts');

/** Where the table is declared — a definition is not a write. */
const DECLARATION = path.join('db', 'schema', 'local-feedback.ts');

function sourceFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(full);
    if (!statSync(full).isFile()) return [];
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

// Comments are stripped before matching so a file *documenting* the rule is
// not mistaken for one breaking it — this codebase explains itself in
// comments, and a red build for a sentence would train people to weaken the
// check.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const WRITE_PATTERNS = [
  /\.insert\(\s*localComments/,
  /\.update\(\s*localComments/,
  /\.delete\(\s*localComments/,
  /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+local_comments/i,
];

describe('local_comments is read-only outside this prefetch', () => {
  const files = sourceFilesUnder(MOBILE_SRC);

  it('finds the source tree it means to scan', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((file) => file.endsWith(SOLE_WRITER))).toBe(true);
  });

  it('has exactly one writer, and it is this task', () => {
    const writers = files.filter((file) => {
      const source = stripComments(readFileSync(file, 'utf8'));
      return WRITE_PATTERNS.some((pattern) => pattern.test(source));
    });

    expect(writers.map((file) => path.relative(MOBILE_SRC, file))).toEqual([SOLE_WRITER]);
  });

  it('is referenced by nothing but its declaration and this task', () => {
    const referencing = files.filter((file) => {
      const source = stripComments(readFileSync(file, 'utf8'));
      return /localComments|local_comments/.test(source);
    });

    expect(referencing.map((file) => path.relative(MOBILE_SRC, file)).sort()).toEqual(
      [DECLARATION, SOLE_WRITER].sort(),
    );
  });

  it('carries no clientLocalId and no syncState — the columns an offline writer would need', () => {
    const declaration = readFileSync(path.join(MOBILE_SRC, DECLARATION), 'utf8');
    const table = declaration.slice(declaration.indexOf("sqliteTable('local_comments'"));

    expect(table).not.toMatch(/client_local_id/);
    expect(table).not.toMatch(/sync_state/);
  });
});
