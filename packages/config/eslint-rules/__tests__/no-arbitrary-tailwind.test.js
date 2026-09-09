// theme-tokens/01, /05: NativeWind has no compiler for Tailwind's
// arbitrary-value syntax (`bg-[#141A24]`, `p-[13px]`) and drops it
// silently. Unlike the colour rules, there is no `ignores` list on this
// registration — no file has a legitimate reason to use it.
'use strict';

const { Linter, RuleTester } = require('eslint');

const reactNativeConfig = require('../../eslint.react-native.js');
const rule = require('../no-arbitrary-tailwind.js');

const ruleTester = new RuleTester();

ruleTester.run('no-arbitrary-tailwind', rule, {
  valid: [
    "const className = 'flex-row items-center px-4 bg-brand';",
    "const className = 'p-4 gap-2 rounded-lg';",
    // A negative utility is still a token, not an arbitrary value.
    "const className = '-mt-4';",
    // Brackets not attached to a utility name are not this rule's concern.
    "const note = 'see the [design doc] for the ramp';",
  ],
  invalid: [
    {
      code: "const className = 'bg-[#141A24]';",
      errors: [{ messageId: 'arbitraryValue' }],
    },
    {
      code: "const className = 'p-[13px]';",
      errors: [{ messageId: 'arbitraryValue' }],
    },
    {
      code: "const className = 'w-[50%]';",
      errors: [{ messageId: 'arbitraryValue' }],
    },
    {
      // Inside a template literal, not just a plain string.
      code: 'const className = `grid-cols-[1fr,2fr]`;',
      errors: [{ messageId: 'arbitraryValue' }],
    },
  ],
});

describe('the eslint.react-native.js wiring', () => {
  const RULE_ID = 'theme/no-arbitrary-tailwind';
  const entry = reactNativeConfig.find((config) => config.rules?.[RULE_ID] !== undefined);

  it('registers the rule at error severity with no exemptions', () => {
    expect(entry).toBeDefined();
    expect(entry.rules[RULE_ID]).toBe('error');
    expect(entry.ignores).toBeUndefined();
  });

  it('reports an arbitrary-value class anywhere, including the theme package', () => {
    const messages = new Linter().verify(
      "const className = 'bg-[#141A24]';",
      [entry],
      'src/theme/tokens.ts',
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ ruleId: RULE_ID, severity: 2 });
  });
});
