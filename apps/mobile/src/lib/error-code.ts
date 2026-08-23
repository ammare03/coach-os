import { APP_ERROR_CODES, type AppErrorCode, type AppErrorPayloads } from '@coachos/schemas';
import { TRPCClientError } from '@trpc/client';

const KNOWN_CODES = new Set<string>(APP_ERROR_CODES);

/**
 * The one place the client reads an error's shape (02's step 7). Every
 * feature switches on the return value — nothing anywhere reads
 * `error.message` to make a decision (CLAUDE.md §7.5: a failed action gets
 * a designed state, not a raw string in a toast).
 */
export function getErrorCode(error: unknown): AppErrorCode | null {
  if (!(error instanceof TRPCClientError)) {
    return null;
  }
  const appCode = (error.data as { appCode?: unknown } | null)?.appCode;
  return typeof appCode === 'string' && KNOWN_CODES.has(appCode) ? (appCode as AppErrorCode) : null;
}

/**
 * The typed payload for a given code, paired with `getErrorCode` so a
 * caller narrows once instead of casting `error.data` by hand at every
 * call site:
 *
 * ```ts
 * const code = getErrorCode(error);
 * if (code === 'SEAT_LIMIT_REACHED') {
 *   const { seatsUsed, seatLimit } = getErrorDetails(error, code)!;
 * }
 * ```
 */
export function getErrorDetails<Code extends AppErrorCode>(
  error: unknown,
  code: Code,
): AppErrorPayloads[Code] | null {
  if (!(error instanceof TRPCClientError) || getErrorCode(error) !== code) {
    return null;
  }
  const data = error.data as { details?: unknown } | null;
  return (data?.details ?? null) as AppErrorPayloads[Code] | null;
}
