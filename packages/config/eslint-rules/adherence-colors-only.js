// `DESIGN.md` §8: the adherence warmth ramp means adherence state and
// nothing else, and `urgent` means missed/overdue/record/destructive and is
// never decorative. Flags a Tailwind utility or a token property access
// naming one of those colours outside the allowlist — registration passes
// the allowlist as `ignores`, this rule just flags every use it sees.
//
// The palette has NO GREEN (§8), so the old green/amber/red trio does not
// exist any more; what needs guarding instead is the ramp, whose stops
// (`onPlan` is literally `brand.DEFAULT`) would otherwise be reachable as
// ordinary decoration and destroy the coach's colour scan.
'use strict';

// Matches e.g. `bg-state-onPlan`, `text-state-offPlan/20`, `border-urgent`
// — a Tailwind colour utility (bg/text/border/fill/stroke) naming a
// restricted token, at any opacity.
const CLASS_RE =
  /\b(?:bg|text|border|fill|stroke)-(?:state-(?:onPlan|drifting|offPlan|notStarted)|urgent(?:-text)?)\b/;
// Matches `colors.state.onPlan`, `colors.urgent`, `colors['urgent-text']` in JS.
const PROPERTY_RE =
  /\bcolors(?:\.state\.(?:onPlan|drifting|offPlan|notStarted)\b|\.urgent\b|\['urgent-text'\])/;

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow the adherence warmth ramp and `urgent` outside adherence-state files (DESIGN.md §8).',
    },
    schema: [],
    messages: {
      adherenceColor:
        '"{{value}}" is reserved for adherence state (DESIGN.md §8) — it may not appear outside an adherence-state file, and it must always carry a second, non-colour channel. If this is genuinely an adherence surface, add the file to the allowlist in eslint.react-native.js with a comment explaining why.',
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
