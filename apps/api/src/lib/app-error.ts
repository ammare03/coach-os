import { APP_ERROR_TRPC_CODE, type AppErrorCode, type AppErrorPayloads } from '@coachos/schemas';
import { TRPCError } from '@trpc/server';

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
