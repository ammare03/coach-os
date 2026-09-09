// db-package-scaffold/05: CLAUDE.md §17.1 / DATABASE.md DB§11.2's hard rule
// that a database row type is inferred from Drizzle, never hand-written, as
// a check that runs. The heuristic (an object literal with an `id` field)
// is imperfect by design (see the rule's own doc comment) — the valid cases
// below include exactly the derived shape (`typeof x.$inferSelect`, a
// TSTypeQuery) it must never flag.
'use strict';

const { Linter, RuleTester } = require('eslint');
const tseslintParser = require('typescript-eslint').parser;

const baseConfig = require('../../eslint.base.js');
const rule = require('../no-hand-written-row-type.js');

const ruleTester = new RuleTester({ languageOptions: { parser: tseslintParser } });

ruleTester.run('no-hand-written-row-type', rule, {
  valid: [
    // The sanctioned shape: inferred from Drizzle, a TSTypeQuery, never a
    // TSTypeLiteral.
    'type SetLog = typeof setLogs.$inferSelect;',
    'type NewSetLog = typeof setLogs.$inferInsert;',
    // An object shape with no `id` field is not a row type by this
    // heuristic — component props, for example.
    'interface SetLogRowProps { onEdit: (id: string) => void; }',
    'type SetLogRowProps = { onEdit: (id: string) => void };',
    // A non-object type alias.
    'type ClientId = string;',
  ],
  invalid: [
    {
      code: 'interface SetLog { id: string; weightKg: number; }',
      errors: [{ messageId: 'handWritten' }],
    },
    {
      code: 'type SetLog = { id: string; weightKg: number };',
      errors: [{ messageId: 'handWritten' }],
    },
    {
      code: 'interface ClientProfile { id: string; }',
      errors: [{ messageId: 'handWritten' }],
    },
  ],
});

// The rule firing in isolation is only half of it — this asserts the
// registration in eslint.base.js itself: error severity, and the
// packages/db exemption where the real $inferSelect declarations live.
describe('the eslint.base.js wiring', () => {
  const RULE_ID = 'local/no-hand-written-row-type';
  const FILENAME = 'apps/api/src/routers/clients.ts';
  // The registration carries no parser of its own — that comes from the
  // typescript-eslint config entries earlier in the array — so the wiring
  // check supplies it directly rather than pulling in the whole file.
  const parserEntry = { languageOptions: { parser: tseslintParser } };
  const entry = baseConfig.find((config) => config.rules?.[RULE_ID] !== undefined);

  it('registers the rule at error severity', () => {
    expect(entry).toBeDefined();
    expect(entry.rules[RULE_ID]).toBe('error');
  });

  it('reports a hand-written row type outside packages/db', () => {
    const messages = new Linter().verify(
      'interface SetLog { id: string; }',
      [parserEntry, entry],
      FILENAME,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ ruleId: RULE_ID, severity: 2 });
  });

  it('exempts packages/db, where the real $inferSelect declarations live', () => {
    const messages = new Linter().verify(
      'interface SetLog { id: string; }',
      [parserEntry, entry],
      'packages/db/src/schema.ts',
    );

    expect(messages.filter((m) => m.ruleId === RULE_ID)).toEqual([]);
  });
});
