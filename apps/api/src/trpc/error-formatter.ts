import type { AppErrorPayloads } from '@coachos/schemas';
import type { TRPCDefaultErrorShape, TRPCErrorFormatter } from '@trpc/server';
import { ZodError } from 'zod';

import { isCatalogedError } from '../lib/app-error.ts';

import type { Context } from './context.ts';

/**
 * The fixed wire shape (02's Interfaces section): every error's `data`
 * carries `appCode`, `details`, and `requestId` on top of tRPC's own
 * `code` / `httpStatus` / `path`. Fixed here because P08's outbox and
 * P20's paywall both branch on it, and changing it later breaks installed
 * builds that haven't taken an OTA update.
 */
export interface AppErrorShape extends Omit<TRPCDefaultErrorShape, 'data'> {
  data: TRPCDefaultErrorShape['data'] & {
    appCode: string;
    details: unknown;
    requestId: string | null;
  };
}

/**
 * Replaces tRPC's default formatter (the seam `api-scaffold/01` left in
 * `init.ts`). One switch selects dev vs prod behaviour — passed in rather
 * than read from `env` directly, so this stays testable without booting the
 * whole process (`testing` skill §2: the formatter test needs no Postgres).
 *
 * Default to production behaviour whenever `isDevelopment` isn't `true` —
 * step 5: a missing or misspelled value must not open the verbose branch.
 */
export function createErrorFormatter(opts: {
  isDevelopment: boolean;
}): TRPCErrorFormatter<Context, AppErrorShape> {
  const { isDevelopment } = opts;

  return ({ shape, error, ctx }) => {
    const requestId = ctx?.requestId ?? null;

    // 1. A Zod input-validation failure. Flatten to one message per field —
    // never the raw issue tree, never the value that was typed (step 4).
    // This holds in every environment; step 5's "Zod issue tree" in
    // development refers to what the terminal log carries, not the wire
    // response — see the uncaught branch below for that logging.
    if (error.cause instanceof ZodError) {
      // Walk `.issues` directly rather than the deprecated `.flatten()` —
      // `error.cause` is `ZodError<unknown>` here (the catch site has no
      // schema to attach), and flatten()'s `fieldErrors` type degrades to
      // `{}` once its generic can't resolve, which `.issues` never does.
      const fields: Record<string, string> = {};
      for (const issue of error.cause.issues) {
        const [first] = issue.path;
        const key = first === undefined ? '_form' : String(first);
        if (!(key in fields)) fields[key] = issue.message;
      }

      const details: AppErrorPayloads['VALIDATION_FAILED'] = { fields };
      return {
        ...shape,
        message: 'Some fields need attention.',
        data: { ...shape.data, appCode: 'VALIDATION_FAILED', details, requestId },
      };
    }

    // 2. A catalogued error, thrown deliberately via appError(). Its
    // message is product copy the caller chose — pass it through
    // unmodified in every environment (step 5's diagram: "catalogued: code
    // + typed payload + copy").
    if (isCatalogedError(error)) {
      return {
        ...shape,
        message: error.message,
        data: {
          ...shape.data,
          appCode: error.cause.appCode,
          details: error.cause.details,
          requestId,
        },
      };
    }

    // 3. Uncaught. Always log the full error under the requestId — the
    // Verification section is explicit that a production response without
    // a matching log line means "the formatter swallowed it and production
    // failures are now invisible."
    // console.error is the one sanctioned sink until ../observability/01-structured-logger.md lands
    console.error(`[${requestId ?? 'no-request-id'}] uncaught error`, error);

    if (isDevelopment) {
      return {
        ...shape,
        // `exactOptionalPropertyTypes` rejects `stack: undefined` outright —
        // spread the key in only when Error.stack actually produced one.
        data: {
          ...shape.data,
          appCode: 'INTERNAL_ERROR',
          details: {},
          requestId,
          ...(error.stack !== undefined ? { stack: error.stack } : {}),
        },
      };
    }

    return {
      ...shape,
      message: 'Something went wrong. Contact support with this reference.',
      data: { ...shape.data, appCode: 'INTERNAL_ERROR', details: {}, requestId },
    };
  };
}
