import { TRPCClientError } from '@trpc/client';

import {
  getRateLimitInfo,
  handleRateLimitError,
  setRateLimitNotifier,
} from '../rate-limit-handling.ts';

function rateLimitedError(retryAfterSeconds: number): TRPCClientError<never> {
  return TRPCClientError.from({
    error: {
      code: -32000,
      message: 'Too many requests. Try again shortly.',
      data: {
        code: 'TOO_MANY_REQUESTS',
        httpStatus: 429,
        appCode: 'RATE_LIMITED',
        details: { retryAfterSeconds },
      },
    },
  });
}

function otherError(): TRPCClientError<never> {
  return TRPCClientError.from({
    error: {
      code: -32001,
      message: "We couldn't find that.",
      data: { code: 'NOT_FOUND', httpStatus: 404, appCode: 'NOT_YOUR_CLIENT', details: {} },
    },
  });
}

describe('getRateLimitInfo', () => {
  it('extracts retryAfterSeconds from a RATE_LIMITED error', () => {
    expect(getRateLimitInfo(rateLimitedError(42))).toEqual({ retryAfterSeconds: 42 });
  });

  it('returns null for any other error code', () => {
    expect(getRateLimitInfo(otherError())).toBeNull();
  });

  it('returns null for a non-tRPC error', () => {
    expect(getRateLimitInfo(new Error('network down'))).toBeNull();
  });
});

describe('handleRateLimitError', () => {
  afterEach(() => {
    // Restore the module's default notifier so tests don't leak state into
    // each other — `setRateLimitNotifier` mutates shared module scope.
    setRateLimitNotifier(() => {});
  });

  it('calls the notifier with the retry hint on a RATE_LIMITED error', () => {
    const notifier = jest.fn();
    setRateLimitNotifier(notifier);

    handleRateLimitError(rateLimitedError(15));

    expect(notifier).toHaveBeenCalledWith({ retryAfterSeconds: 15 });
  });

  it('does not call the notifier for a non-rate-limit error', () => {
    const notifier = jest.fn();
    setRateLimitNotifier(notifier);

    handleRateLimitError(otherError());

    expect(notifier).not.toHaveBeenCalled();
  });
});
