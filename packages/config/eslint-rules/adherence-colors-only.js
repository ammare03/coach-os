// CLAUDE.md §7.2 / DESIGN-SYSTEM.md DS§2.5: green/amber/red mean adherence
// state and nothing else. Flags a Tailwind utility or a token property
// access naming one of the adherence/danger colours outside the allowlist
// (theme-tokens/05) — registration passes the allowlist as `ignores`, this
// rule just flags every use it sees.
'use strict';

// Matches e.g. `bg-state-onTrack`, `text-state-offTrack/20`, `border-danger`
// — a Tailwind colour utility (bg/text/border/fill/stroke) naming a
// restricted token, at any opacity.
const CLASS_RE =
  /\b(?:bg|text|border|fill|stroke)-(?:state-(?:onTrack|drifting|offTrack|noData)|danger)\b/;
// Matches `colors.state.onTrack`, `colors.danger`, `theme.colors.state.offTrack` in JS.
const PROPERTY_RE = /\bcolors\.(?:state\.(?:onTrack|drifting|offTrack|noData)|danger)\b/;

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow success/warning/danger adherence colours outside adherence-state files (CLAUDE.md §7.2, DESIGN-SYSTEM.md DS§2.5).',
    },
    schema: [],
    messages: {
      adherenceColor:
        '"{{value}}" is reserved for adherence state (DESIGN-SYSTEM.md DS§2.5) — it may not appear outside an adherence-state file. If this is genuinely an adherence surface, add the file to the allowlist in eslint.react-native.js with a comment explaining why.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    function checkString(node, value) {
      if (typeof value !== 'string') return;
      if (CLASS_RE.test(value)) {
        context.report({ node, messageId: 'adherenceColor', data: { value } });
      }
    }

    return {
      Literal(node) {
        checkString(node, node.value);
      },
      TemplateElement(node) {
        checkString(node, node.value.raw);
      },
      MemberExpression(node) {
        const text = sourceCode.getText(node);
        if (PROPERTY_RE.test(text)) {
          context.report({ node, messageId: 'adherenceColor', data: { value: text } });
        }
      },
    };
  },
};

module.exports = rule;
