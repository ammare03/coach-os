import { getErrorCode, getErrorDetails } from '../../lib/error-code.ts';

export interface AuthFormError {
  formMessage: string;
  fieldErrors?: Record<string, string>;
}

const GENERIC_ERROR: AuthFormError = { formMessage: 'Something went wrong. Try again.' };
const VALIDATION_ERROR_MESSAGE = 'Check the highlighted fields and try again.';

/**
 * Maps a caught tRPC error to copy this app designed, never the server's
 * own `error.message` — `error-code.ts`'s own doc comment is explicit that
 * nothing in this app reads it to decide what to show (CLAUDE.md §7.5). A
 * code this form didn't expect falls back to the generic message rather
 * than a raw string.
 */
export function mapAuthError(error: unknown, copyByCode: Record<string, string>): AuthFormError {
  const code = getErrorCode(error);
  if (code === 'VALIDATION_FAILED') {
    const details = getErrorDetails(error, 'VALIDATION_FAILED');
    return details?.fields === undefined
      ? { formMessage: VALIDATION_ERROR_MESSAGE }
      : { formMessage: VALIDATION_ERROR_MESSAGE, fieldErrors: details.fields };
  }
  const message = code === null ? undefined : copyByCode[code];
  return message === undefined ? GENERIC_ERROR : { formMessage: message };
}
