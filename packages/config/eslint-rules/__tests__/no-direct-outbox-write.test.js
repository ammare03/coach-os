// outbox/01's third acceptance criterion, as a check that runs: nothing
// outside apps/mobile/src/lib/outbox may write to the `outbox` table, by
// either route — importing the Drizzle table to build an insert, or hand-
// writing the SQL. Reads stay legal (wipe.ts counts pending rows,
// schema-version.ts groups them).
'use strict';

const { Linter, RuleTester } = require('eslint');

const reactNativeConfig = require('../../eslint.react-native.js');
const rule = require('../no-direct-outbox-write.js');

const ruleTester = new RuleTester();

ruleTester.run('no-direct-outbox-write', rule, {
  valid: [
    // Reads — `db/wipe.ts` and `db/schema-version.ts` both do exactly this.
    "db.get(sql`SELECT COUNT(*) AS pending FROM outbox WHERE status != 'done'`);",
    'db.all(sql`SELECT procedure, COUNT(*) AS count FROM outbox GROUP BY procedure`);',
    // The bootstrap DDL in db/schema/sync.ts.
    'const ddl = `CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY)`;',
    'const idx = `CREATE INDEX IF NOT EXISTS outbox_ready ON outbox (status, next_attempt_at)`;',
    // Writes to any other local table.
    'db.run(sql`INSERT INTO local_set_logs (id) VALUES (${id})`);',
    'db.run(sql`UPDATE upload_queue SET bytes_sent = ${n}`);',
    // Sibling tables from the same schema module are unrestricted.
    "import { localSetLogs, uploadQueue } from '../../db/schema/index.ts';",
    // A same-named export from somewhere that is not the local schema.
    "import { outbox } from 'some-unrelated-package';",
    // The word alone, in prose or an identifier, is not a write.
    'const outboxCount = 3;',
    "const message = 'Your outbox has pending entries';",
  ],
  invalid: [
    {
      code: "import { outbox } from '../../db/schema/sync.ts';",
      errors: [{ messageId: 'outboxTableImport' }],
    },
    {
      code: "import { outbox } from '../db/schema/index.ts';",
      errors: [{ messageId: 'outboxTableImport' }],
    },
    {
      // Renaming on import does not change what it is.
      code: "import { outbox as outboxTable } from '../../db/schema/index.ts';",
      errors: [{ messageId: 'outboxTableImport' }],
    },
    {
      code: 'db.run(sql`INSERT INTO outbox (id, procedure) VALUES (${id}, ${p})`);',
      errors: [{ messageId: 'outboxWriteSql' }],
    },
    {
      code: 'db.run(sql`UPDATE outbox SET status = ${status} WHERE id = ${id}`);',
      errors: [{ messageId: 'outboxWriteSql' }],
    },
    {
      code: 'db.run(sql`DELETE FROM outbox WHERE id = ${id}`);',
      errors: [{ messageId: 'outboxWriteSql' }],
    },
    {
      // Lower case, plain string, and a newline between the keywords.
      code: "db.run('insert into\\n  outbox (id) values (1)');",
      errors: [{ messageId: 'outboxWriteSql' }],
    },
    {
      code: 'const stmt = `REPLACE INTO outbox (id) VALUES (${id})`;',
      errors: [{ messageId: 'outboxWriteSql' }],
    },
  ],
});

// A rule that is never registered, or registered where it cannot match the
// files it guards, is a rule that does not run. This asserts the wiring
// exported for apps/mobile/eslint.config.js.
describe('the exported apps/mobile wiring', () => {
  const RULE_ID = 'outbox/no-direct-outbox-write';
  const entry = reactNativeConfig.noDirectOutboxWriteRule;

  it('is exported at error severity', () => {
    expect(entry).toBeDefined();
    expect(entry.rules[RULE_ID]).toBe('error');
  });

  it('applies to the TypeScript files the app is written in', () => {
    expect(entry.files).toEqual(['**/*.{ts,tsx}']);
  });

  it('reports a hand-written outbox insert from a feature file', () => {
    const messages = new Linter().verify(
      'db.run(sql`INSERT INTO outbox (id) VALUES (${id})`);',
      [entry],
      'src/features/workouts/api.ts',
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ ruleId: RULE_ID, severity: 2 });
  });

  // An ignored file produces Linter's own "No matching configuration found"
  // notice rather than an empty array — what matters is that the rule
  // itself never fires, which the negative control above proves it
  // otherwise would.
  it('exempts the sanctioned enqueue/flush module itself', () => {
    const messages = new Linter().verify(
      'db.run(sql`INSERT INTO outbox (id) VALUES (${id})`);',
      [entry],
      'src/lib/outbox/enqueue.ts',
    );

    expect(messages.filter((m) => m.ruleId === RULE_ID)).toEqual([]);
  });

  it('exempts the local schema tests, which exercise the table shape directly', () => {
    const messages = new Linter().verify(
      'db.run(sql`INSERT INTO outbox (id) VALUES (${id})`);',
      [entry],
      'src/db/__tests__/schema.test.ts',
    );

    expect(messages.filter((m) => m.ruleId === RULE_ID)).toEqual([]);
  });
});
