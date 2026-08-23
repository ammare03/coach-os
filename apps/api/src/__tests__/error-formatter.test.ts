import type { TRPCDefaultErrorShape } from '@trpc/server';
import { TRPCError } from '@trpc/server';
import { z, type ZodError } from 'zod';

import { appError } from '../lib/app-error.ts';
import type { Context } from '../trpc/context.ts';
import { createErrorFormatter } from '../trpc/error-formatter.ts';

const baseShape: TRPCDefaultErrorShape = {
  message: 'original message',
  code: -32600,
  data: { code: 'BAD_REQUEST', httpStatus: 400, path: 'workouts.logSet' },
};

const ctx = { requestId: 'req-123' } as unknown as Context;

function zodErrorFor(): ZodError {
  const result = z.object({ email: z.string().email() }).safeParse({ email: 'not-an-email' });
  if (result.success) {
    throw new Error('fixture setup failed — expected a validation failure');
  }
  return result.error;
}

describe('createErrorFormatter — Zod validation failures', () => {
  it('returns VALIDATION_FAILED with one message per field, never the raw issue tree', () => {
    const formatter = createErrorFormatter({ isDevelopment: false });
    const cause = zodErrorFor();
    const error = new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid input', cause });

    const shape = formatter({
      shape: baseShape,
      error,
      type: 'mutation',
      path: 'auth.signUp',
      input: undefined,
      ctx,
    });

    expect(shape.data.appCode).toBe('VALIDATION_FAILED');
    expect((shape.data.details as { fields: Record<string, string> }).fields.email).toEqual(
      expect.any(String),
    );
    expect(shape.data).not.toHaveProperty('zodError');
    expect(JSON.stringify(shape.data)).not.toContain('not-an-email'); // never echoes the typed value back
  });
});

describe('createErrorFormatter — a catalogued error', () => {
  it("carries the error's own appCode, details, and message unmodified", () => {
    const formatter = createErrorFormatter({ isDevelopment: false });
    const error = appError(
      'SEAT_LIMIT_REACHED',
      'You have reached your client limit for this plan.',
      {
        seatsUsed: 10,
        seatLimit: 10,
      },
    );

    const shape = formatter({
      shape: baseShape,
      error,
      type: 'mutation',
      path: 'coach.clients.invite',
      input: undefined,
      ctx,
    });

    expect(shape.data.appCode).toBe('SEAT_LIMIT_REACHED');
    expect(shape.data.details).toEqual({ seatsUsed: 10, seatLimit: 10 });
    expect(shape.message).toBe('You have reached your client limit for this plan.');
    expect(shape.data.requestId).toBe('req-123');
  });
});

describe('createErrorFormatter — an uncaught error', () => {
  const uncaught = new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'relation "users" does not exist',
  });

  it('in production mode: INTERNAL_ERROR, generic copy, requestId, no stack, no original message', () => {
    const formatter = createErrorFormatter({ isDevelopment: false });

    const shape = formatter({
      shape: baseShape,
      error: uncaught,
      type: 'query',
      path: undefined,
      input: undefined,
      ctx,
    });

    expect(shape.data.appCode).toBe('INTERNAL_ERROR');
    expect(shape.data.requestId).toBe('req-123');
    expect(shape.data.stack).toBeUndefined();
    expect(shape.message).not.toContain('relation "users"');
  });

  it('in development mode: the message and the stack are both present', () => {
    const formatter = createErrorFormatter({ isDevelopment: true });

    const shape = formatter({
      shape: baseShape,
      error: uncaught,
      type: 'query',
      path: undefined,
      input: undefined,
      ctx,
    });

    expect(shape.data.appCode).toBe('INTERNAL_ERROR');
    expect(shape.message).toBe(baseShape.message);
    expect(shape.data.stack).toBe(uncaught.stack);
  });

  it('falls to production behaviour whenever isDevelopment is not true', () => {
    // Mirrors 02's acceptance criterion "NODE_ENV unset or unrecognised
    // produces production behaviour" — init.ts only ever passes `true` for
    // the literal string 'development'; anything else collapses to `false`
    // before it reaches this formatter, which is what this asserts.
    const formatter = createErrorFormatter({ isDevelopment: false });

    const shape = formatter({
      shape: baseShape,
      error: uncaught,
      type: 'query',
      path: undefined,
      input: undefined,
      ctx,
    });

    expect(shape.data.stack).toBeUndefined();
  });
});
