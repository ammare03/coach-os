import { APP_ERROR_TRPC_CODE, type AppErrorCode, type AppErrorPayloads } from '@coachos/schemas';
import { TRPCError } from '@trpc/server';
import type postgres from 'postgres';

import {
  getMappedConstraintCode,
  REPLAY_CONSTRAINTS,
  REPLAY_ENTITY_NAMES,
  type MappedConstraintCode,
} from '../db/constraint-map.ts';
import { unwrapDatabaseError } from '../db/is-database-error.ts';
import { isConnectionException, SQLSTATE_TREATMENTS } from '../db/sqlstate.ts';

import { logger } from './logger.ts';

/**
 * The shape every catalogued error's `cause` carries. `../trpc/error-formatter.ts`
 * reads it to fill `error.data.appCode` and `error.data.details` — the fixed
 * wire shape `02-error-formatter-and-codes.md` documents in its Interfaces
 * section.
 */
export interface AppErrorCause<Code extends AppErrorCode = AppErrorCode> {
  appCode: Code;
  details: AppErrorPayloads[Code];
}

/**
 * The only sanctioned way to construct a thrown error in the API (CLAUDE.md
 * §6.3; 02's step 3 — a bare `new TRPCError({ code })` outside this file
 * fails lint, see `packages/config/eslint.base.js`'s `noBareTrpcErrorRules`).
 *
 * `message` is user-facing copy — `api-conventions` §5's example ("You have
 * reached your client limit...") is representative — because only an
 * *uncaught* error gets redacted (02's step 5). A catalogued error is a
 * refusal the product designed for, and its message is safe to show as-is.
 */
export function appError<Code extends AppErrorCode>(
  code: Code,
  message: string,
  details: AppErrorPayloads[Code],
): TRPCError {
  const cause: AppErrorCause<Code> = { appCode: code, details };
  return new TRPCError({
    code: APP_ERROR_TRPC_CODE[code],
    message,
    cause,
  });
}

/**
 * Narrows a caught error to one thrown by `appError` above. The formatter
 * uses this to decide whether to surface `cause.appCode` / `cause.details`
 * or treat the error as uncaught and redact it to `INTERNAL_ERROR`.
 */
export function isCatalogedError(error: unknown): error is TRPCError & { cause: AppErrorCause } {
  return (
    error instanceof TRPCError &&
    typeof error.cause === 'object' &&
    error.cause !== null &&
    'appCode' in error.cause &&
    'details' in error.cause
  );
}

const UNIQUE_VIOLATION = '23505';

// The safe fields (`04-no-raw-db-errors.md` step 7) — never `detail`,
// `where`, or `internal_query`, which can quote a caller's value (DB§18).
function logDatabaseError(error: postgres.PostgresError, requestId: string): void {
  logger.error('db.error', {
    requestId,
    dbErrorCode: error.code,
    constraint: error.constraint_name ?? null,
    table: error.table_name ?? null,
    schema: error.schema_name ?? null,
  });
}

// The three payload shapes `../db/sqlstate.ts`'s treatments actually use.
// A switch, not a generic `appError(treatment.appCode, ...)` call, because
// `AppErrorPayloads[Code]` varies per code and `appCode`'s static type here
// is the whole `AppErrorCode` union — TypeScript cannot distribute a
// generic call over a value it hasn't narrowed to a literal.
function appErrorForSqlState(appCode: AppErrorCode): TRPCError {
  switch (appCode) {
    case 'VALIDATION_FAILED':
      // Should be impossible — `../../error-and-validation/03-validation-conventions.md`
      // exists precisely so a CHECK/not-null/truncation violation never
      // reaches Postgres. Reaching here is a bug report, not a user error.
      return appError('VALIDATION_FAILED', 'That data could not be saved as sent.', {
        fields: { _form: 'This value is not valid.' },
      });
    case 'SYNC_CONFLICT':
      // Genuine write contention (40001), not a unique-violation replay —
      // there's no constraint name here to resolve a product entity from,
      // and `error.table_name` is step 7's exact "never to return" field.
      return appError('SYNC_CONFLICT', 'That change is out of date — refresh and try again.', {
        entity: 'record',
      });
    default:
      // INTERNAL_ERROR, and the fallback for any future SQLSTATE_TREATMENTS
      // entry this switch hasn't been taught yet — never a bare 500 with no
      // catalogued code.
      return appError(
        'INTERNAL_ERROR',
        'Something went wrong. Contact support with this reference.',
        {},
      );
  }
}

/**
 * Translates a raw database error into a catalogued `TRPCError`
 * (`error-and-validation/04-no-raw-db-errors.md`) — the only other
 * construction site besides `appError()` above, and it builds through
 * `appError()`, never `new TRPCError()` directly (04's Interfaces: "no new
 * construction path; it maps onto the existing one").
 *
 * Two outcomes only: returns a `TRPCError` for a database error, or
 * rethrows a non-database error completely untouched, so whatever's
 * upstream — `02`'s formatter, or nothing at all — still gets first look
 * at anything this function doesn't recognise as ours.
 *
 * Pure translation: no retry, no I/O beyond the one safe-fields log line.
 * Retry needs a second `next()` call, which only `../db/error-boundary.ts`'s
 * middleware has; this is what that middleware calls once retry is
 * exhausted, and — per 04's Interfaces — what a non-tRPC caller (the
 * background worker) calls directly, with no tRPC context at all.
 */
export function fromDatabaseError(error: unknown, ctx: { requestId: string }): TRPCError {
  const dbError = unwrapDatabaseError(error);
  if (!dbError) {
    throw error;
  }

  logDatabaseError(dbError, ctx.requestId);

  if (dbError.code === UNIQUE_VIOLATION) {
    const constraint = dbError.constraint_name ?? '';

    const mappedCode = getMappedConstraintCode(constraint);
    if (mappedCode) {
      // Every entry in CONSTRAINT_ERROR_MAP is restricted to an
      // EmptyErrorPayload code — see that file's own doc comment for why.
      return appError(mappedCode, describeCode(mappedCode), {});
    }

    if (REPLAY_CONSTRAINTS.has(constraint)) {
      // The safe generic fallback for a resolver that hasn't adopted the
      // upsert-or-catch pattern yet (04 step 4): "refetch", never a 500.
      // A resolver written against `isReplayViolation()` in
      // `../db/error-boundary.ts` never reaches this branch at all — its
      // own catch clause re-selects the row and returns success directly.
      return appError('SYNC_CONFLICT', 'That change is out of date — refresh and try again.', {
        entity: REPLAY_ENTITY_NAMES[constraint] ?? 'record',
      });
    }

    // No mapping (step 3): a generic, safe conflict. The constraint name
    // was already logged above under this requestId — that is the prompt
    // to add a specific code, deliberately, not a default to leave as-is.
    return appError('UNKNOWN_CONFLICT', 'That change conflicts with something already saved.', {});
  }

  const treatment = SQLSTATE_TREATMENTS[dbError.code];
  if (treatment) {
    return appErrorForSqlState(treatment.appCode);
  }

  if (isConnectionException(dbError.code)) {
    return appError(
      'INTERNAL_ERROR',
      'Something went wrong. Contact support with this reference.',
      {},
    );
  }

  // Anything else — full detail already logged above, nothing to the client.
  return appError(
    'INTERNAL_ERROR',
    'Something went wrong. Contact support with this reference.',
    {},
  );
}

// Product copy for a CONSTRAINT_ERROR_MAP hit, keyed by the same
// EmptyPayloadCode type that map's values are restricted to — adding a
// constraint mapping to a new empty-payload code fails this switch until
// its copy is written here too.
function describeCode(code: MappedConstraintCode): string {
  switch (code) {
    case 'CLIENT_ALREADY_HAS_COACH':
      return 'This client already has an active coach.';
    default:
      return code satisfies never;
  }
}
