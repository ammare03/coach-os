// `account-lifecycle/12` — the `operatorProcedure` gate. Composes onto
// `protectedProcedure` only, so `ctx.user` is already non-null here; reuses
// `../../lib/is-operator.ts`'s own narrow, dedicated query rather than
// widening `ContextUser` with an `internalOperator` field every ordinary
// request would then carry for no reason (that file's own doc comment).
import { appError } from '../../lib/app-error.ts';
import { isOperator } from '../../lib/is-operator.ts';
import { middleware } from '../init.ts';

export const isOperatorMiddleware = middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw appError('AUTH_REQUIRED', 'Sign in to continue.', {});
  }
  if (!(await isOperator(ctx.db, ctx.user.id))) {
    // `ROLE_REQUIRED`, not a dedicated code — SUPPORT.md SU§2's admin
    // surface is staff-only by construction, not a product-tier gate; an
    // ordinary coach or client hitting this is the same shape of refusal
    // `hasRole` already gives a client calling a coach-only procedure.
    throw appError('ROLE_REQUIRED', 'This action requires operator access.', {
      requiredRole: 'operator',
    });
  }
  return next();
});
