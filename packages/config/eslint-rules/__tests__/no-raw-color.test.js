// theme-tokens/02: a colour is written down exactly once, in
// packages/ui/src/theme/tokens.ts and schemes.ts (CLAUDE.md §7.2,
// DESIGN-SYSTEM.md DS§2). This proves the rule flags a raw hex/rgb/hsl
// value wherever it appears, and that the theme package itself plus the
// handful of tests and components DESIGN.md names as legitimate exceptions
// — listed as `ignores` on the registration, not on the rule — stay exempt.
'use strict';

const { Linter, RuleTester } = require('eslint');

const reactNativeConfig = require('../../eslint.react-native.js');
const rule = require('../no-raw-color.js');

const ruleTester = new RuleTester();

ruleTester.run('no-raw-color', rule, {
  valid: [
    // A token reference, not a literal.
    'const bg = colors.bg.DEFAULT;',
    "const className = 'flex-row items-center px-4 bg-brand';",
    // Hex-looking characters with no leading `#` and no rgb/hsl call are
    // not a colour.
    "const label = 'deadbeef is not a colour';",
    // Numbers are not colour strings.
    'const count = 42;',
  ],
  invalid: [
    {
      code: "const bg = '#141A24';",
      errors: [{ messageId: 'rawColor' }],
    },
    {
      code: "const bg = '#fff';",
      errors: [{ messageId: 'rawColor' }],
    },
    {
      code: "const overlay = 'rgba(20, 26, 36, 0.5)';",
      errors: [{ messageId: 'rawColor' }],
    },
    {
      code: "const overlay = 'hsl(210, 50%, 20%)';",
      errors: [{ messageId: 'rawColor' }],
    },
    {
      // A colour inside a template literal, not just a plain string.
      code: 'const style = `background-color: #141A24;`;',
      errors: [{ messageId: 'rawColor' }],
    },
  ],
});

// The rule firing in isolation is only half of it — a registration whose
// `ignores` doesn't actually cover the files DESIGN.md names as exceptions
// is a registration that blocks the theme package from existing.
describe('the eslint.react-native.js wiring', () => {
  const RULE_ID = 'theme/no-raw-color';
  const FILENAME = 'src/components/Card.tsx';
  const entry = reactNativeConfig.find((config) => config.rules?.[RULE_ID] !== undefined);

  it('registers the rule at error severity', () => {
    expect(entry).toBeDefined();
    expect(entry.rules[RULE_ID]).toBe('error');
  });

  it('reports a raw hex literal in an ordinary component file', () => {
    const messages = new Linter().verify("const bg = '#141A24';", [entry], FILENAME);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ ruleId: RULE_ID, severity: 2 });
  });

  it('exempts theme/tokens.ts — this IS where a colour is written down', () => {
    const messages = new Linter().verify(
      "export const colors = { bg: { DEFAULT: '#161E2F' } };",
      [entry],
      'src/theme/tokens.ts',
    );

    expect(messages.filter((m) => m.ruleId === RULE_ID)).toEqual([]);
  });

  it('exempts the contrast audit, which has to feed the parser real hex/rgba values', () => {
    const messages = new Linter().verify(
      "const invalid = '#zzz';",
      [entry],
      'src/theme/contrast-audit.test.ts',
    );

    expect(messages.filter((m) => m.ruleId === RULE_ID)).toEqual([]);
  });
});
