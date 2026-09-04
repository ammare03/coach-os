// NativeWind has no compiler for Tailwind's arbitrary-value syntax
// (`bg-[#141A24]`, `p-[13px]`) — it silently produces nothing
// (theme-tokens/01 verified this; theme-tokens/02 restricted the spacing
// scale specifically so an off-scale value fails loudly instead). Applies
// everywhere, not just theme files — there is no legitimate use.
'use strict';

const ARBITRARY_RE = /\b[a-z][\w-]*-\[[^\]]+\]/;

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow Tailwind arbitrary-value class syntax (e.g. bg-[#141A24], p-[13px]) — NativeWind drops it silently (theme-tokens/01, /05).',
    },
    schema: [],
    messages: {
      arbitraryValue:
        'Arbitrary-value Tailwind class "{{value}}" — NativeWind has no compiler for this and drops it silently. Use a token from @coachos/ui/theme instead.',
    },
  },
  create(context) {
    function check(node, value) {
      if (typeof value === 'string' && ARBITRARY_RE.test(value)) {
        context.report({ node, messageId: 'arbitraryValue', data: { value } });
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
