// `enqueueMutation()` in apps/mobile/src/lib/outbox/enqueue.ts is the one
// sanctioned way anything queues an offline mutation
// (phase-08-offline-core/outbox/01). A second write path — even an
// innocuous direct insert added under time pressure — bypasses the
// guarantee the whole phase rests on: that `client_local_id` is a UUIDv7
// generated once, at the moment of the user's action, and never regenerated
// (DB§14.1, `offline-sync` skill §3). A regenerated id turns one set into
// one set per retry, silently.
//
// Two routes to the table, so two checks:
//   1. importing the `outbox` Drizzle table from the local schema, which is
//      what a `db.insert(outbox)` builder call needs;
//   2. hand-written SQL, which is how the rest of apps/mobile/src/db already
//      talks to SQLite and would therefore be the likelier shortcut.
//
// Reads are deliberately untouched — `db/wipe.ts` counts pending rows before
// a logout wipe and `db/schema-version.ts` groups them for the reset
// dialog, and neither can create or mutate an idempotency key.
'use strict';

const TABLE_EXPORT = 'outbox';

/** Relative paths into the device mirror's schema — `../../db/schema/sync.ts`, `../db/schema/index.ts`. */
const LOCAL_SCHEMA_SOURCE = /(^|\/)db\/schema(\/[\w.-]+)?$/;

/** INSERT/REPLACE INTO, UPDATE, DELETE FROM — every statement that can create or change an outbox row. */
const OUTBOX_WRITE = /\b(?:(?:insert|replace)\s+into|update|delete\s+from)\s+outbox\b/i;

function isLocalSchemaSource(rawSource) {
  const withoutExtension = rawSource.replace(/\.[cm]?[jt]sx?$/, '');
  return LOCAL_SCHEMA_SOURCE.test(withoutExtension);
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow writing to the local `outbox` table outside apps/mobile/src/lib/outbox — enqueue through enqueueMutation() so clientLocalId is generated exactly once (DB§14.1).',
    },
    schema: [],
    messages: {
      outboxTableImport:
        'Importing the `outbox` table here means building an outbox write by hand. Call enqueueMutation() from apps/mobile/src/lib/outbox/enqueue.ts instead — it generates the UUIDv7 clientLocalId once, which is the guarantee every offline mutation depends on (DB§14.1).',
      outboxWriteSql:
        'This writes to the `outbox` table directly. Call enqueueMutation() from apps/mobile/src/lib/outbox/enqueue.ts instead — a second write path can regenerate clientLocalId, which turns one logged set into one per retry (DB§14.1, offline-sync §3). Reads are fine; this is a write.',
    },
  },
  create(context) {
    function checkSqlText(node, text) {
      if (typeof text === 'string' && OUTBOX_WRITE.test(text)) {
        context.report({ node, messageId: 'outboxWriteSql' });
      }
    }

    return {
      ImportDeclaration(node) {
        if (!isLocalSchemaSource(node.source.value)) {
          return;
        }
        for (const specifier of node.specifiers) {
          if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === TABLE_EXPORT
          ) {
            context.report({ node: specifier, messageId: 'outboxTableImport' });
          }
        }
      },
      Literal(node) {
        checkSqlText(node, node.value);
      },
      TemplateElement(node) {
        checkSqlText(node, node.value.raw);
      },
    };
  },
};

module.exports = rule;
