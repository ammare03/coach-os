// Classifies what a probe call actually did (`04-authz-enumeration-test.md`
// step 3) — a `TypeError` must never be mistaken for a refusal, and
// neither must an empty result or a `NOT_FOUND`. Only one outcome counts
// as the guard having fired.
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
const REFUSAL_APP_CODES = new Set(['NOT_YOUR_CLIENT', 'ROLE_REQUIRED']);

export async function classifyProbe(call: () => Promise<unknown>): Promise<ProbeOutcome> {
  let result: unknown;
  try {
    result = await call();
  } catch (error: unknown) {
    if (error instanceof TRPCError) {
      if (
        error.code === 'FORBIDDEN' &&
        isCatalogedError(error) &&
        REFUSAL_APP_CODES.has(error.cause.appCode)
      ) {
        return { verdict: 'refused', code: error.code, appCode: error.cause.appCode };
      }
      if (error.code === 'NOT_FOUND') {
        // An existence oracle, not a refusal — `03-owns-resource.md` step 2.
        return { verdict: 'answered', description: 'NOT_FOUND (existence oracle, not a refusal)' };
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
