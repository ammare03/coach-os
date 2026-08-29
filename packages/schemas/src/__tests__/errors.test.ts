import {
  APP_ERROR_CODES,
  APP_ERROR_TRPC_CODE,
  isExpectedAppErrorCode,
  type AppErrorCode,
  type AppErrorPayloads,
  type TRPCErrorCodeName,
} from '../errors.ts';

const VALID_TRPC_CODES: ReadonlySet<TRPCErrorCodeName> = new Set([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'TOO_MANY_REQUESTS',
  'PAYLOAD_TOO_LARGE',
  'INTERNAL_SERVER_ERROR',
]);

// Compile-time proof that the union is exhaustive-checkable: removing a case
// below — or adding a code to APP_ERROR_CODES without a matching case here —
// fails `pnpm check`'s typecheck at the `default` branch, per 02's
// acceptance criterion. `assertNever`'s `never` parameter type is what does
// the work; the runtime body only needs to not throw for every real code.
function assertNever(value: never): never {
  throw new Error(`Unhandled AppErrorCode: ${String(value)}`);
}

function describeCode(code: AppErrorCode): string {
  switch (code) {
    case 'SEAT_LIMIT_REACHED':
    case 'STORAGE_QUOTA_EXCEEDED':
    case 'LIVE_MINUTES_EXHAUSTED':
    case 'AI_LIMIT_REACHED':
    case 'FEATURE_NOT_IN_TIER':
    case 'NOT_YOUR_CLIENT':
    case 'MEDIA_STILL_PROCESSING':
    case 'CHECKIN_ALREADY_SUBMITTED':
    case 'CLIENT_ALREADY_HAS_COACH':
    case 'INVITE_EXPIRED':
    case 'INVITE_NOT_FOUND':
    case 'INVITE_ALREADY_ACCEPTED':
    case 'INVITE_REVOKED':
    case 'RECORDING_CONSENT_REQUIRED':
    case 'SYNC_CONFLICT':
    case 'VALIDATION_FAILED':
    case 'AUTH_REQUIRED':
    case 'ROLE_REQUIRED':
    case 'RATE_LIMITED':
    case 'PAYLOAD_TOO_LARGE':
    case 'INTERNAL_ERROR':
    case 'UNKNOWN_CONFLICT':
    case 'REFRESH_TOKEN_REUSED':
    case 'REFRESH_RACE':
    case 'AGE_BELOW_MINIMUM':
    case 'COACH_MUST_BE_ADULT':
    case 'GUARDIAN_CONSENT_REQUIRED':
    case 'GUARDIAN_CONSENT_PENDING':
    case 'SOCIAL_ACCOUNT_EXISTS':
    case 'SOCIAL_TOKEN_INVALID':
    case 'CLIENT_HAS_NO_COACH':
    case 'EXPORT_ALREADY_RUNNING':
    case 'EXPORT_RATE_LIMITED':
    case 'EXPORT_NOT_FOUND':
      return code;
    default:
      return assertNever(code);
  }
}

// A value of the empty-payload type must accept nothing but `{}` — this
// line alone fails to compile if `NOT_YOUR_CLIENT`'s payload ever grows a
// field (DB§18: it must never carry the id that failed an ownsResource check).
const emptyPayloadCheck: AppErrorPayloads['NOT_YOUR_CLIENT'] = {};
void emptyPayloadCheck;

describe('APP_ERROR_CODES / APP_ERROR_TRPC_CODE', () => {
  it('maps every code to exactly one valid tRPC code', () => {
    for (const code of APP_ERROR_CODES) {
      expect(VALID_TRPC_CODES.has(APP_ERROR_TRPC_CODE[code])).toBe(true);
    }
  });

  it('has no tRPC-code entry for a code outside the union', () => {
    expect(Object.keys(APP_ERROR_TRPC_CODE).sort()).toEqual([...APP_ERROR_CODES].sort());
  });

  it('is exhaustive-checkable — every code compiles through the switch above', () => {
    for (const code of APP_ERROR_CODES) {
      expect(describeCode(code)).toBe(code);
    }
  });
});

describe('isExpectedAppErrorCode', () => {
  it('is false only for INTERNAL_ERROR', () => {
    for (const code of APP_ERROR_CODES) {
      expect(isExpectedAppErrorCode(code)).toBe(code !== 'INTERNAL_ERROR');
    }
  });
});
