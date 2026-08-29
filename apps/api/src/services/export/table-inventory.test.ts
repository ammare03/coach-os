// `account-lifecycle/09`'s required "fails on divergence" test — pure set
// arithmetic over `table-inventory.ts`, no database needed. This is
// deliberately a unit test, not a fixture-and-Postgres test like
// `../../jobs/data-export.test.ts`: the invariant it protects is entirely
// about the two lists in one file staying honest with each other, not
// about anything the database can tell us.
import { EXPORT_EXCLUDED, EXPORT_TABLES, PURGE_TABLES } from './table-inventory.ts';

describe('export/purge table inventory sync', () => {
  it('exports every purged table, unless the exclusion is documented', () => {
    const purgeNames = new Set(PURGE_TABLES.map((t) => t.name));
    const exportNames = new Set(EXPORT_TABLES);
    const excludedNames = new Set(Object.keys(EXPORT_EXCLUDED));

    const undocumentedGaps = [...purgeNames].filter(
      (name) => !exportNames.has(name) && !excludedNames.has(name),
    );
    expect(undocumentedGaps).toEqual([]);
  });

  it('never exports a table the purge order does not name', () => {
    const purgeNames = new Set(PURGE_TABLES.map((t) => t.name));
    const orphanExports = EXPORT_TABLES.filter((name) => !purgeNames.has(name));
    expect(orphanExports).toEqual([]);
  });

  it('every documented exclusion is an actual purge table, and has a real reason', () => {
    const purgeNames = new Set(PURGE_TABLES.map((t) => t.name));
    for (const [name, reason] of Object.entries(EXPORT_EXCLUDED)) {
      expect(purgeNames.has(name)).toBe(true);
      expect(reason.length).toBeGreaterThan(0);
    }
  });

  it('a table excluded from export is never ALSO claimed as exported', () => {
    const exportNames = new Set(EXPORT_TABLES);
    for (const name of Object.keys(EXPORT_EXCLUDED)) {
      expect(exportNames.has(name)).toBe(false);
    }
  });

  // The literal AC: "Add a table to the purge order without adding it to
  // the export; assert the sync test fails." Simulated here rather than by
  // actually editing purge-account.ts, so this test doesn't depend on a
  // second file's contents to prove its own mechanism works.
  it('fails when a table is added to the purge list but nowhere else', () => {
    const purgeNames = new Set([...PURGE_TABLES.map((t) => t.name), 'training.program_days']);
    const exportNames = new Set(EXPORT_TABLES);
    const excludedNames = new Set(Object.keys(EXPORT_EXCLUDED));

    const undocumentedGaps = [...purgeNames].filter(
      (name) => !exportNames.has(name) && !excludedNames.has(name),
    );
    expect(undocumentedGaps).toEqual(['training.program_days']);
  });
});
