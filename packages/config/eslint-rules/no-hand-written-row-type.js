// Heuristic for CLAUDE.md §17.1 / DATABASE.md DB§11.2's hard rule: never
// hand-write a TypeScript type that Drizzle's `$inferSelect` already
// produces (db-package-scaffold/05).
//
// Not a perfect check — it cannot know every table's real shape without
// duplicating Drizzle's own type inference, which would be worse than the
// problem it solves. It catches the common case instead: an `interface` or
// `type` declared as an object literal with an `id` field — the shape of
// almost every database row in this schema (DATABASE.md DB§5's implicit
// boilerplate) — rather than derived via `typeof someTable.$inferSelect`
// (a `TSTypeQuery`, which this rule never flags).
'use strict';

/**
 * ESLint's own `Rule.RuleListener` types cover the ESTree node set only, so
 * the TypeScript-ESLint nodes this rule visits are described here — just the
 * slice it reads, not the whole AST.
 *
 * @typedef {{ type: string; key?: { type: string; name?: string } }} TsMember
 * @typedef {import('eslint').Rule.Node & { id: { name: string }; body?: { body?: TsMember[] } }} TsInterfaceNode
 * @typedef {import('eslint').Rule.Node & { id: { name: string }; typeAnnotation: { type: string; members?: TsMember[] } }} TsTypeAliasNode
 */

/** @param {TsMember[]} members */
function hasIdMember(members) {
  return members.some(
    (member) =>
      member.type === 'TSPropertySignature' &&
      member.key?.type === 'Identifier' &&
      member.key.name === 'id',
  );
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow a hand-written interface/type shaped like a database row; import the inferred type from @coachos/db instead.',
    },
    schema: [],
    messages: {
      handWritten:
        '"{{name}}" looks like a hand-written database row type (an object literal with an `id` field). ' +
        'Import the inferred type from @coachos/db (packages/db/src/types.ts) instead of redeclaring the shape ' +
        '(CLAUDE.md §17.1, DATABASE.md DB§11.2).',
    },
  },
  create(context) {
    return {
      /** @param {TsInterfaceNode} node */
      TSInterfaceDeclaration(node) {
        const members = node.body?.body ?? [];
        if (hasIdMember(members)) {
          context.report({ node, messageId: 'handWritten', data: { name: node.id.name } });
        }
      },
      /** @param {TsTypeAliasNode} node */
      TSTypeAliasDeclaration(node) {
        if (node.typeAnnotation.type !== 'TSTypeLiteral') return;
        if (hasIdMember(node.typeAnnotation.members ?? [])) {
          context.report({ node, messageId: 'handWritten', data: { name: node.id.name } });
        }
      },
    };
  },
};

module.exports = rule;
