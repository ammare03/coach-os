import { schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';

/**
 * `SUPPORT.md` SU§2: "users with an `internal_operator` flag" — the column
 * DATABASE.md already reserves for this (`users.internal_operator`,
 * "granted by direct DB access only; no application surface sets it"). This
 * is the first application-surface *read* of it
 * (`observability/06-metrics-and-alerts.md`'s operator-gated metrics
 * route) — deliberately narrow: one column, one id, never the fuller
 * `resolveUser` join `../trpc/context.ts` runs for an ordinary request,
 * which is more code path than a high-privilege check needs.
 */
export async function isOperator(db: DbClient, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ internalOperator: schema.users.internalOperator, deletedAt: schema.users.deletedAt })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  return row !== undefined && row.internalOperator && row.deletedAt === null;
}
