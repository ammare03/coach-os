import { env } from '../env.ts';

/**
 * The structured (JSON) logger (`observability/01-structured-logging.md`).
 * No dependency added — CLAUDE.md §3.4.1 step 2: Node's own `process.stdout`
 * plus `JSON.stringify` is already everything an allowlist-based line logger
 * needs, and a third-party logger's own defaults are exactly the kind of
 * "serialise the whole object" behaviour this design exists to avoid.
 *
 * DB§18's classification is absolute: 🔴/🟠 fields (names, emails, food,
 * messages, health values) never reach a log line. This is enforced
 * structurally, not by developer discipline — `LogFields` below is a closed
 * type with no index signature, and `buildEntry` copies only its known keys,
 * so a caller cannot make an unlisted field reach the output even by
 * spreading a bigger object in with a cast.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * The allowlist (`01-structured-logging.md`'s Approach step 1). Every field
 * a log call may carry, ever. Adding one is a deliberate, reviewed decision
 * — never a side effect of some procedure gaining a new input field.
 */
export interface LogFields {
  requestId?: string;
  procedure?: string;
  durationMs?: number;
  statusCode?: number;
  userId?: string | null;
  role?: string;
  errorCode?: string;
  jobId?: string;
  queue?: string;
  attempt?: number;
  count?: number;
  bytes?: number;
  // The Postgres-error boundary's safe fields (`error-and-validation/04-no-raw-db-errors.md`
  // step 7) — a SQLSTATE plus schema identifiers, never `detail`, `where`, or
  // `internal_query`, which can quote a caller's value.
  dbErrorCode?: string;
  constraint?: string | null;
  table?: string | null;
  schema?: string | null;
}

const ALLOWED_KEYS = [
  'requestId',
  'procedure',
  'durationMs',
  'statusCode',
  'userId',
  'role',
  'errorCode',
  'jobId',
  'queue',
  'attempt',
  'count',
  'bytes',
  'dbErrorCode',
  'constraint',
  'table',
  'schema',
] as const satisfies readonly (keyof LogFields)[];

interface LogEntry extends LogFields {
  ts: string;
  level: LogLevel;
  msg: string;
}

// A same-key, same-type copy — kept as its own generic function because
// assigning `target[key] = value` directly inside the loop below collapses
// `key` to the union of every `LogFields` key while `value` stays tied to
// just one of them, which TypeScript correctly refuses to unify.
function assign<K extends keyof LogFields>(target: LogFields, key: K, value: LogFields[K]): void {
  target[key] = value;
}

// Copies only `ALLOWED_KEYS` off `fields` — never `{ ...fields }` or
// `JSON.stringify(fields)` directly, which would forward whatever else the
// caller's object happens to hold. This is the one line the adversarial test
// in `logger.test.ts` exists to hold accountable.
function buildEntry(level: LogLevel, msg: string, fields: LogFields = {}): LogEntry {
  const picked: LogFields = {};
  for (const key of ALLOWED_KEYS) {
    const value = fields[key];
    if (value !== undefined) {
      assign(picked, key, value);
    }
  }
  return { ts: new Date().toISOString(), level, msg, ...picked };
}

function write(entry: LogEntry): void {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

/**
 * `logger.info('set.logged', { requestId, procedure, durationMs })`. `msg`
 * must be a fixed string, never a template literal carrying a value — values
 * belong in `fields`, where the allowlist above can see and gate them
 * (`observability-ops` skill §1's interpolation trap).
 */
export const logger = {
  debug(msg: string, fields?: LogFields): void {
    // Off in production per `observability-ops` §3 — enabling it per-request
    // for an operator is `observability/06-metrics-and-alerts.md`'s job, not
    // this module's.
    if (env.NODE_ENV === 'production') return;
    write(buildEntry('debug', msg, fields));
  },
  info(msg: string, fields?: LogFields): void {
    write(buildEntry('info', msg, fields));
  },
  warn(msg: string, fields?: LogFields): void {
    write(buildEntry('warn', msg, fields));
  },
  error(msg: string, fields?: LogFields): void {
    write(buildEntry('error', msg, fields));
  },
};
