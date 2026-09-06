import { TRPCClientError } from '@trpc/client';

import {
  handleGuardianConsentError,
  isGuardianConsentPending,
  setGuardianConsentNotifier,
} from '../guardian-consent-handling.ts';

function appError(appCode: string, code = 'FORBIDDEN', httpStatus = 403): TRPCClientError<never> {
  return TRPCClientError.from({
    error: { code: -32000, message: 'refused', data: { code, httpStatus, appCode } },
  } as never);
}

beforeEach(() => {
  // Shared module scope — every test installs its own notifier.
  setGuardianConsentNotifier(() => {});
});

describe('isGuardianConsentPending', () => {
  it('recognises the catalogued code', () => {
    expect(isGuardianConsentPending(appError('GUARDIAN_CONSENT_PENDING'))).toBe(true);
  });

  it.each([
    appError('SEAT_LIMIT_REACHED'),
    appError('RATE_LIMITED', 'TOO_MANY_REQUESTS', 429),
    appError('AUTH_REQUIRED', 'UNAUTHORIZED', 401),
    new Error('the network went away'),
    null,
  ])('leaves %# alone', (error) => {
    expect(isGuardianConsentPending(error)).toBe(false);
  });
});

describe('handleGuardianConsentError', () => {
  it('routes a gated call to the pending screen', () => {
    const notifier = jest.fn();
    setGuardianConsentNotifier(notifier);

    handleGuardianConsentError(appError('GUARDIAN_CONSENT_PENDING'));

    expect(notifier).toHaveBeenCalledTimes(1);
  });

  // The whole point of the central handler: every other failure keeps its
  // own screen's error state, with a Retry that can actually succeed.
  it('leaves every other error to the screen that made the call', () => {
    const notifier = jest.fn();
    setGuardianConsentNotifier(notifier);

    handleGuardianConsentError(appError('SEAT_LIMIT_REACHED'));
    handleGuardianConsentError(new Error('offline'));

    expect(notifier).not.toHaveBeenCalled();
  });
});
