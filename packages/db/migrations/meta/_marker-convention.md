# The non-transactional marker

Two statement types DB§12.3 requires in production cannot run inside a transaction block:

```sql
CREATE INDEX CONCURRENTLY ...     -- Postgres rejects this inside a transaction
ALTER TYPE ... ADD VALUE ...      -- rejected on older Postgres inside a transaction
```

`packages/db/src/migrate.ts` (not `drizzle-kit migrate`) is what applies every migration in
this project, precisely so it can detect and handle these correctly.

## How to mark a migration

The migration file's **first non-empty line** must read exactly:

```sql
-- drizzle:non-transactional
```

`migrate.ts` checks for this exact string, verbatim, with no trailing text on the same line.
A typo here is silent: the migration falls through to the ordinary transactional path,
Postgres rejects the `CONCURRENTLY` (or `ALTER TYPE ... ADD VALUE`) statement, and the error
you see is a generic Postgres one — not "you forgot the marker." If a migration containing
either statement type fails with an unexpected transaction-related error, check this line
first.

## What the runner does with it

- **No marker:** every statement in the file runs inside a single `BEGIN … COMMIT`. A failure
  rolls the whole file back — nothing from it is applied. This is `drizzle-kit`'s own default
  behaviour, unchanged.
- **Marker present:** every statement runs individually, outside any transaction. A failure
  stops immediately; `migrate.ts` reports exactly which statement (by number) failed and which
  earlier statements in the same file already committed. **There is no automatic rollback of
  DDL that already ran** (DB§12.4) — recovery is fix forward (a new migration) or a
  point-in-time restore (DB§20). Design every migration so fixing forward is always possible.

## One file, one kind

A single migration file must not mix marked and unmarked statements — DB§12.1 point 3
already requires one logical change per migration, and a file needing both transactional and
non-transactional statements is a sign it should have been two migrations.

## Applied-migration bookkeeping

`migrate.ts` records applied migrations in the same `drizzle.__drizzle_migrations` table
(same schema, same `hash`/`created_at` shape) that `drizzle-kit`'s own migrator uses — there
is exactly one bookkeeping mechanism, not a second one specific to this runner.
