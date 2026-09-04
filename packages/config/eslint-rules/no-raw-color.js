// CLAUDE.md §7.2 / DESIGN-SYSTEM.md DS§2: a colour is written down exactly
// once, in `packages/ui/src/theme/tokens.ts` and `schemes.ts`
// (theme-tokens/02, /04). Registration (`eslint.react-native.js`) scopes
// this to the files that are actually entitled to have colours contain a
// hex/rgb/hsl literal — the rule itself just flags them wherever it runs.
'use strict';

const COLOR_RE = /(#[0-9a-fA-F]{3,8}\b)|(\b(?:rgba?|hsla?)\()/;

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow a raw hex/rgb/hsl colour literal outside packages/ui/src/theme — use a token from @coachos/ui/theme instead.',
    },
    schema: [],
    messages: {
      rawColor:
        'Raw colour literal "{{value}}" — use a token from @coachos/ui/theme instead (CLAUDE.md §7.2, theme-tokens/02).',
    },
  },
  create(context) {
    function check(node, value) {
      if (typeof value === 'string' && COLOR_RE.test(value)) {
        context.report({ node, messageId: 'rawColor', data: { value } });
      }
    }
    return {
      Literal(node) {
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.raw);
      },
    };
  },
};

module.exports = rule;
