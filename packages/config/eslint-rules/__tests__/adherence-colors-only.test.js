// DESIGN.md §8: the adherence warmth ramp — colors.state.onPlan/drifting/
// offPlan/notStarted plus colors.urgent/`urgent-text` — means adherence
// state and nothing else, everywhere outside the allowlisted
// adherence-state files in eslint.react-native.js.
//
// Note the token names checked here (onPlan/offPlan/notStarted) are NOT the
// same strings as packages/utils/src/adherence.ts's AdherenceState /
// ADHERENCE_TOKEN (onTrack/offTrack/noData) — that mismatch is a deliberate
// indirection (AdherenceDot.tsx:44-49): the state->token decision lives in
// adherence.ts, and this rule only guards what the token LOOKS like in
// packages/ui/src/theme/tokens.ts. This is a confirmed false alarm, not a
// bug — do not "fix" it by renaming either side.
'use strict';

const { Linter, RuleTester } = require('eslint');

const reactNativeConfig = require('../../eslint.react-native.js');
const rule = require('../adherence-colors-only.js');

const ruleTester = new RuleTester();

ruleTester.run('adherence-colors-only', rule, {
  valid: [
    // No restricted colour named at all.
    "const className = 'bg-brand text-fg-DEFAULT';",
    // A different `bg-state-*` name is not in the restricted set.
    "const className = 'bg-state-something-else';",
    // Property access on an unrelated object is not `colors.state.*`.
    'const value = other.state.onPlan;',
  ],
  invalid: [
    {
      code: "const className = 'bg-state-onPlan';",
      errors: [{ messageId: 'adherenceColor' }],
    },
    {
      // Any opacity suffix still names the restricted token.
      code: "const className = 'text-state-offPlan/20';",
      errors: [{ messageId: 'adherenceColor' }],
    },
    {
      code: "const className = 'border-urgent';",
      errors: [{ messageId: 'adherenceColor' }],
    },
    {
      code: "const className = 'text-urgent-text';",
      errors: [{ messageId: 'adherenceColor' }],
    },
    {
      code: 'const ring = colors.state.onPlan;',
      errors: [{ messageId: 'adherenceColor' }],
    },
    {
      code: 'const fill = colors.urgent;',
      errors: [{ messageId: 'adherenceColor' }],
    },
  ],
});

describe('the eslint.react-native.js wiring', () => {
  const RULE_ID = 'theme/adherence-colors-only';
  const entry = reactNativeConfig.find((config) => config.rules?.[RULE_ID] !== undefined);

  it('registers the rule at error severity', () => {
    expect(entry).toBeDefined();
    expect(entry.rules[RULE_ID]).toBe('error');
  });

  it('reports the ramp outside the allowlisted adherence-state files', () => {
    const messages = new Linter().verify(
      "const className = 'bg-state-onPlan';",
      [entry],
      'src/components/Card.tsx',
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ ruleId: RULE_ID, severity: 2 });
  });

  it('exempts AdherenceDot.tsx, the component the ramp exists for', () => {
    const messages = new Linter().verify(
      'const ring = colors.state.onPlan;',
      [entry],
      'src/components/AdherenceDot.tsx',
    );

    expect(messages.filter((m) => m.ruleId === RULE_ID)).toEqual([]);
  });

  it("exempts Button.tsx's danger variant, the sanctioned destructive treatment", () => {
    const messages = new Linter().verify(
      "const className = 'border-urgent';",
      [entry],
      'src/components/Button.tsx',
    );

    expect(messages.filter((m) => m.ruleId === RULE_ID)).toEqual([]);
  });
});
