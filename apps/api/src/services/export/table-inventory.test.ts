// `account-lifecycle/09`'s required "fails on divergence" test — pure set
// arithmetic over `table-inventory.ts`, no database needed. This is
// deliberately a unit test, not a fixture-and-Postgres test like
// `../../jobs/data-export.test.ts`: the invariant it protects is entirely
// about the two lists in one file staying honest with each other, not
// about anything the database can tell us.
import { schema } from '@coachos/db';
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';

import { EXPORT_EXCLUDED, EXPORT_TABLES, PURGE_TABLES } from './table-inventory.ts';

// F15: the five tests below all relate PURGE_TABLES/EXPORT_TABLES/
// EXPORT_EXCLUDED to EACH OTHER — nothing ever compared any of them to the
// Drizzle schema itself, so a table added in a later phase and wired into
// neither list passed every one of them. This introspects `@coachos/db`'s
// own schema object (same technique as `packages/db/scripts/list-updated-
// at-tables.ts` and `apps/mobile/src/db/__tests__/schema-ddl-drift.test.ts`)
// rather than hand-listing tables a fourth time.
function allSchemaTableNames(): Set<string> {
  const names = new Set<string>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    names.add(`${config.schema ?? 'public'}.${config.name}`);
  }
  return names;
}

/**
 * Tables the Drizzle schema names that are, by design, in none of
 * PURGE_TABLES/EXPORT_TABLES/EXPORT_EXCLUDED — reviewed here, once, each
 * with the reason a reviewer needs. An UNRESOLVED reason is a real gap:
 * fixing it means giving the table an owner decision, never deleting its
 * entry to make this test pass.
 */
const SCHEMA_ENUMERATION_EXCLUDED: Readonly<Record<string, string>> = {
  // Folded into their named parent at DB§19.2's OWN granularity — the
  // numbered purge block itself writes these as "habits+logs" (step 2) and
  // "meals (cascade meal_items)" (step 3), never as their own line, and
  // `table-inventory.ts`'s own top-of-file comment documents this exact
  // folding convention. Not a gap: `coaching.habits`/`nutrition.meals` are
  // already in PURGE_TABLES and EXPORT_TABLES.
  'coaching.habit_logs': 'folded into coaching.habits — DB§19.2 step 2 names them together',
  'nutrition.meal_items': 'folded into nutrition.meals — DB§19.2 step 3 names them together',
  // Cascade children DB§19.2 never names on their own line, one level
  // further than the folding above: each `ON DELETE CASCADE`s from the
  // next, up to `training.programs`, which IS named (step 4, "coach-owned
  // exercises/programs") and is already in PURGE_TABLES/EXPORT_TABLES.
  // Verified against training.ts's own FK definitions, not assumed.
  'training.program_weeks':
    'cascades ON DELETE from training.programs (training.ts) — already purged/exported as "coach-owned programs", DB§19.2 step 4',
  'training.program_days':
    'cascades ON DELETE from training.program_weeks -> training.programs (training.ts) — same coverage as program_weeks above',
  'training.program_exercises':
    'cascades ON DELETE from training.program_days -> training.programs (training.ts) — same coverage as program_weeks above',
  // Same shape, one level deep from `nutrition.meal_plans`, which IS named
  // in DB§19.2's cascade table and is already in PURGE_TABLES/EXPORT_TABLES.
  'nutrition.meal_plan_days':
    "cascades ON DELETE from nutrition.meal_plans (nutrition.ts) — already purged/exported per DB§19.2's cascade table",
  'nutrition.meal_plan_items':
    'cascades ON DELETE from nutrition.meal_plan_days -> nutrition.meal_plans (nutrition.ts) — same coverage as meal_plan_days above',
  // DB§19.2 step 9, verbatim: NOT deleted. `created_by_user_id` is already
  // SET NULL by the FK; unverified rows are neutralised (name/brand
  // rewritten) in the same transaction, verified rows are shared reference
  // data and are left untouched. Deliberately neither purged nor exported —
  // it survives its creator by design, so it is never "this user's data".
  'nutrition.foods':
    "DB§19.2 step 9 — deliberately retained, not purged (created_by_user_id SET NULL, unverified rows neutralised); not the user's own portable content",
  // DB§19.2 step 6 and DB§18's 🔵 classification, both verbatim: RETAINED
  // through deletion, actor_user_id set NULL by the FK, id only. Without
  // this row surviving, account deletion resets a ban (DB§19.2's own words).
  'platform.audit_log':
    'DB§19.2 step 6 — deliberately retained through deletion (🔵 DB§18); actor_user_id nulled by the FK, id kept for compliance evidence',
  // The schema's own comment on this table is explicit: no user_id column,
  // by design — "every metric here is a system/aggregate count, never data
  // about one person" (platform.ts). Nothing to purge or export.
  'platform.metric_samples':
    "no user_id column — system/aggregate metric sample, never data about one person (platform.ts's own comment)",
  // No FK to users/coach_profiles/client_profiles anywhere on this table
  // (platform.ts: provider, event_id, event_type, payload, timestamps only)
  // — DB§17 describes it as "the ledger for every inbound webhook", a
  // provider-level processing log, not content belonging to any one CoachOS
  // user.
  'platform.webhook_events':
    'no owner FK to users/coach_profiles/client_profiles — a provider-level webhook processing ledger (DB§17), not personal data',
};

describe('every Drizzle table is purged, exported, or a reviewed exclusion', () => {
  it('accounts for every table the schema names', () => {
    const purgeNames = new Set(PURGE_TABLES.map((t) => t.name));
    const exportNames = new Set(EXPORT_TABLES);
    const excludedNames = new Set(Object.keys(EXPORT_EXCLUDED));
    const schemaExcludedNames = new Set(Object.keys(SCHEMA_ENUMERATION_EXCLUDED));

    const unaccounted = [...allSchemaTableNames()].filter(
      (name) =>
        !purgeNames.has(name) &&
        !exportNames.has(name) &&
        !excludedNames.has(name) &&
        !schemaExcludedNames.has(name),
    );
    expect(unaccounted).toEqual([]);
  });

  it('every schema-enumeration exclusion names a real table and a real reason', () => {
    const allTables = allSchemaTableNames();
    for (const [name, reason] of Object.entries(SCHEMA_ENUMERATION_EXCLUDED)) {
      expect(allTables.has(name)).toBe(true);
      expect(reason.length).toBeGreaterThan(0);
      expect(reason).not.toMatch(/^UNRESOLVED/);
    }
  });
});

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
