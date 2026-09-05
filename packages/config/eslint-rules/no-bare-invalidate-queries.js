// `queryClient.invalidateQueries()` with no key refetches every query in the
// cache. The `code-conventions` skill §5 (the rule `CLAUDE.md` §10.1 used to
// carry) bans it outright, and this rule is what turns that from a
// code-review reminder into a build-time check
// (phase-05-app-shell/providers-and-gates/02).
//
// Why it matters more here than in a web app: the device doing the
// refetching is on a gym's basement signal, and the cache it is refetching
// is the one the client is mid-workout inside. One missing argument turns a
// set log into a full-cache round trip.
//
// Both call shapes are covered — the method form
// (`queryClient.invalidateQueries()`, `qc.invalidateQueries()`) and the
// bare-identifier form left by a destructure or a re-export
// (`const { invalidateQueries } = useQueryClient()`).
//
// `invalidateQueries({})` is flagged too: empty filters match every query,
// so it is the same instruction typed differently. Anything with a real
// argument passes — including a deliberately broad prefix like
// `keys.clients.list()`, which is a narrowing decision someone made on
// purpose and can defend in review.
'use strict';

const BANNED_METHOD = 'invalidateQueries';

function isInvalidateQueriesCallee(callee) {
  if (callee.type === 'Identifier') {
    return callee.name === BANNED_METHOD;
  }
  if (callee.type !== 'MemberExpression' || callee.computed) {
    return false;
  }
  return callee.property.type === 'Identifier' && callee.property.name === BANNED_METHOD;
}

/** `{}` — no properties, no spread. Matches every query, exactly like no argument at all. */
function isEmptyObjectLiteral(node) {
  return node.type === 'ObjectExpression' && node.properties.length === 0;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow invalidateQueries() with no key — it refetches the whole cache. Pass a key from apps/mobile/src/lib/query/keys.ts (code-conventions §5).',
    },
    schema: [],
    messages: {
      bareInvalidate:
        'invalidateQueries() with no key refetches every query in the cache. Pass the narrowest key that is now stale, from the factory in apps/mobile/src/lib/query/keys.ts — e.g. invalidateQueries({ queryKey: keys.clients.detail(clientId) }) (code-conventions §5).',
      emptyFilters:
        'invalidateQueries({}) matches every query, which is the same as passing no key at all. Pass the narrowest key that is now stale, from the factory in apps/mobile/src/lib/query/keys.ts (code-conventions §5).',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isInvalidateQueriesCallee(node.callee)) {
          return;
        }
        if (node.arguments.length === 0) {
          context.report({ node, messageId: 'bareInvalidate' });
          return;
        }
        const [first] = node.arguments;
        if (node.arguments.length === 1 && isEmptyObjectLiteral(first)) {
          context.report({ node, messageId: 'emptyFilters' });
        }
      },
    };
  },
};

module.exports = rule;
