// Classifies what a probe call actually did (`04-authz-enumeration-test.md`
// step 3) — a `TypeError` must never be mistaken for a refusal, and
// neither must an empty result or a bare `NOT_FOUND`. Only a catalogued
// refusal counts as the guard having fired.
import { TRPCError } from '@trpc/server';

import { isCatalogedError } from '../../lib/app-error.ts';

export type ProbeOutcome =
  | { verdict: 'refused'; code: string; appCode: string }
  | { verdict: 'answered'; description: string }
  | { verdict: 'crashed'; description: string };

// `NOT_YOUR_CLIENT` and `ROLE_REQUIRED` both count as a refusal — a
// role-mismatched probe (a client probing a coach-only procedure) never
// reaches the ownership check at all, and that is itself proof the caller
// can't read the foreign row, not a gap in coverage.
//
// The refusal is identified by its app code, not its transport code:
// `NOT_YOUR_CLIENT` travels as NOT_FOUND (`ERRORS.md` ER§2.1) and
// `ROLE_REQUIRED` as FORBIDDEN. A NOT_FOUND *without* `NOT_YOUR_CLIENT`
// is a resolver's own lookup answering "no such row", which is the oracle.
const REFUSAL_APP_CODES = new Set(['NOT_YOUR_CLIENT', 'ROLE_REQUIRED']);

export async function classifyProbe(call: () => Promise<unknown>): Promise<ProbeOutcome> {
  let result: unknown;
  try {
    result = await call();
  } catch (error: unknown) {
    if (error instanceof TRPCError) {
      if (isCatalogedError(error) && REFUSAL_APP_CODES.has(error.cause.appCode)) {
        return { verdict: 'refused', code: error.code, appCode: error.cause.appCode };
      }
      if (error.code === 'NOT_FOUND') {
        // A resolver's own "no such row", not the guard — an existence
        // oracle (`03-owns-resource.md` step 2).
        return {
          verdict: 'answered',
          description: `NOT_FOUND without NOT_YOUR_CLIENT (existence oracle, not a refusal)${isCatalogedError(error) ? ` / ${error.cause.appCode}` : ''}`,
        };
      }
      if (error.code === 'BAD_REQUEST' || error.code === 'PAYLOAD_TOO_LARGE') {
        // Likely the synthesiser's fault, not the guard's — but from the
        // enumeration's point of view this procedure's coverage is still
        // unproven, so it fails rather than passing on a technicality.
        return {
          verdict: 'answered',
          description: `${error.code} — synthesis likely produced an invalid input: ${error.message}`,
        };
      }
      return {
        verdict: 'answered',
        description: `unexpected code ${error.code}${isCatalogedError(error) ? ` / ${error.cause.appCode}` : ''}: ${error.message}`,
      };
    }
    return {
      verdict: 'crashed',
      description: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }

  return { verdict: 'answered', description: `resolved: ${JSON.stringify(result)}` };
}
