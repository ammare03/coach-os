import type { AppErrorCode } from '@coachos/schemas';

export interface SqlStateTreatment {
  appCode: AppErrorCode;
  /**
   * One bounded retry — 25–100ms jitter, inside the boundary, before this
   * treatment applies (`04-no-raw-db-errors.md` step 5). Only for a
   * statement that is safe to repeat: a `SELECT`, or a write carrying
   * `clientLocalId`. Never a general retry loop — a second failure means
   * the contention is structural, not transient.
   */
  retryable?: boolean;
}

/**
 * SQLSTATE → default treatment (step 2). Classification reads this table
 * only — never `error.message`, which is localised, version-dependent, and
 * the exact thing this boundary exists to stop reading. `23505`
 * (unique_violation) is deliberately absent: its outcome depends on
 * `constraint-map.ts` first, so `error-boundary.ts` handles it directly
 * rather than through this flat table.
 */
export const SQLSTATE_TREATMENTS: Record<string, SqlStateTreatment> = {
  '23503': { appCode: 'VALIDATION_FAILED' }, // foreign_key_violation — a referenced id does not exist
  '23514': { appCode: 'VALIDATION_FAILED' }, // check_violation — validation should have caught this first
  '23502': { appCode: 'VALIDATION_FAILED' }, // not_null_violation — same note
  '22001': { appCode: 'VALIDATION_FAILED' }, // string_data_right_truncation — a length limit was missed
  '22P02': { appCode: 'VALIDATION_FAILED' }, // invalid_text_representation — a malformed UUID or enum
  '40001': { appCode: 'SYNC_CONFLICT', retryable: true }, // serialization_failure
  '40P01': { appCode: 'INTERNAL_ERROR', retryable: true }, // deadlock_detected
  '57014': { appCode: 'INTERNAL_ERROR' }, // query_canceled — statement timeout; log loudly, a missing index until proven otherwise
  '53300': { appCode: 'INTERNAL_ERROR' }, // too_many_connections
};

/**
 * Connection-exception class — several SQLSTATEs share the `08` prefix
 * (`08000`, `08001`, `08003`, `08004`, `08006`, `08007`, `08P01`), all
 * treated identically: `INTERNAL_ERROR`, logged loudly.
 */
export function isConnectionException(code: string): boolean {
  return code.startsWith('08');
}
