import { schema, type NewAuditLogEntry, type Transaction } from '@coachos/db';

import type { Context } from '../trpc/context.ts';

/**
 * The dotted action-namespace convention (`03-audit-log-writer.md`
 * Approach step 4) — every later phase's call sites follow this shape:
 * `'auth.login'`, `'auth.password_reset'`, `'permission.role_changed'`,
 * `'media.delete'`, `'account.export'`, `'account.purge'`. Not an enum
 * (`db-migrations` skill §5) — the set of actions grows with every phase
 * that writes to `audit_log`, and a closed Postgres enum would make each
 * one a migration.
 */
export interface WriteAuditLogParams {
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * The single writer for `platform.audit_log` (DB§5.5) — every later
 * mutating procedure for auth, permission changes, exports, and deletions
 * calls this (CLAUDE.md §21.2), never an ad hoc `INSERT`, so the one place
 * this table is written stays consistent with its own DB§8.3 append-only
 * rules.
 *
 * Takes `tx` with no default — never opens its own transaction — so an
 * audit write always commits or rolls back atomically with the action it
 * records (`derived-data/03`'s pattern: an audit record for a deletion that
 * then failed would be a false record). Takes `ctx` separately from `tx`,
 * matching `../lib/app-error.ts`'s `fromDatabaseError(error, ctx)` — one
 * parameter for "how to reach the database", a different one for "what this
 * request already knows" — rather than folding both into a single options
 * bag with `params`.
 *
 * `actorUserId`, `ip`, and `userAgent` are read from `ctx` automatically
 * (Approach step 2) — a call site only ever supplies `action` and, where it
 * applies, `targetType`/`targetId`/`metadata`. `ctx.request.ip` (not
 * `trustedIp`) is deliberate: `../trpc/context.ts`'s own doc comment on
 * `RequestMeta.ip` names this table as its one sanctioned use, since a
 * compliance record benefits from best-effort provenance even where it
 * isn't trustworthy enough for `trustedIp`'s stricter jobs (rate limiting).
 */
export async function writeAuditLog(
  tx: Transaction,
  ctx: Pick<Context, 'user' | 'request'>,
  params: WriteAuditLogParams,
): Promise<void> {
  const row: NewAuditLogEntry = {
    actorUserId: ctx.user?.id ?? null,
    action: params.action,
    targetType: params.targetType ?? null,
    targetId: params.targetId ?? null,
    ip: ctx.request.ip,
    userAgent: ctx.request.userAgent,
    metadata: params.metadata ?? {},
  };

  await tx.insert(schema.auditLog).values(row);
}
