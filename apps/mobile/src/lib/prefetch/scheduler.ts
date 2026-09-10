import { AppState, type AppStateStatus } from 'react-native';

import { useAuthStore } from '../../features/auth/store.ts';
import { ensureConnectivityTracking, useConnectivityStore } from '../connectivity/store.ts';
import { getErrorCode } from '../error-code.ts';
import { flushOutbox } from '../outbox/flush.ts';
import { ensureClientTimeZoneHydrated } from '../time-zone/store.ts';

import { prefetchFoods } from './foods.ts';
import { prefetchHistory } from './history.ts';
import { prefetchSessionsAndExercises, upcomingRange } from './sessions.ts';

/**
 * How long after a run starts the foreground trigger stops re-running.
 *
 * iOS emits `'active'` for a control-centre pull or a dismissed permission
 * sheet as readily as for a real return from background. Without a floor,
 * refetching 30 days of history is one swipe away, repeatedly, on whatever
 * connection the client has (`CLAUDE.md` §19's battery budget). Direct
 * `runPrefetch()` calls are not throttled — this is the trigger's rule, not
 * the run's.
 */
export const PREFETCH_MIN_INTERVAL_MS = 5 * 60_000;

export type PrefetchStepName = 'sessions' | 'foods' | 'history';

/** Why a run did nothing. Each is a normal state, never an error. */
export type PrefetchSkipReason = 'offline' | 'not-signed-in' | 'not-a-client';

export type PrefetchRunOutcome =
  | { status: 'skipped'; reason: PrefetchSkipReason }
  /** `failed` is empty on a clean run; a listed step logged and was stepped over. */
  | { status: 'completed'; failed: PrefetchStepName[] };

export interface RunPrefetchOptions {
  /**
   * Defaults to `lib/time-zone/store.ts` — the client's stored
   * `users.timezone`, and the device's only until something has resolved
   * it. **This used to default to the device zone in each step
   * independently, which is `docs/UNFORGET.md` S32**: the Today card
   * resolves the day from the stored zone, and the two prefetchers divide
   * one `payload_json` column by that date, so a client whose two zones
   * differ lost their whole prescription. Overridable because the day
   * boundary has to be testable.
   */
  timeZone?: string;
  now?: Date;
}

let inFlight: Promise<PrefetchRunOutcome> | null = null;
let lastRunStartedAtMs = 0;

function skipReason(): PrefetchSkipReason | null {
  if (!useConnectivityStore.getState().isConnected) return 'offline';
  const { status, role } = useAuthStore.getState();
  if (status !== 'authenticated') return 'not-signed-in';
  // All three reads are `clientProcedure`s; a coach foregrounding would
  // otherwise spend three round trips being refused.
  if (role !== 'client') return 'not-a-client';
  return null;
}

async function runStep(name: PrefetchStepName, step: () => Promise<unknown>): Promise<boolean> {
  try {
    await step();
    return true;
  } catch (error: unknown) {
    // Fixed message, code only — never the error's own text
    // (`observability-ops` §1). Logged rather than thrown: prefetch is a
    // convenience, and a failure costs a network round trip, never data.
    console.warn('prefetch.step_failed', {
      step: name,
      errorCode: getErrorCode(error) ?? 'UNEXPECTED',
    });
    return false;
  }
}

/**
 * Sequential, and each step isolated from the ones after it.
 *
 * Sequential because the connection this exists to beat is the bad one:
 * three concurrent requests on gym signal is how all three time out, and
 * three write bursts landing together is the frame cost this task's Risks
 * name. Nothing here has a latency budget — it is already behind the UI.
 *
 * Sessions run first because today's workout is the one thing that must be
 * there when the signal is not.
 *
 * **The day boundary is decided here, once, and handed down** — the fix for
 * `docs/UNFORGET.md` S32, in three parts:
 *
 * 1. One `now` for the pass. Because the steps run one after another, a
 *    pass that begins at 23:59:59 reached the history step on the next
 *    calendar day, and every date that step derived was a day out.
 * 2. One `timeZone` for the pass, from the one resolver the Today card
 *    also reads (`lib/time-zone/store.ts`). Two sources for "the client's
 *    zone" is how the writer and the reader disagreed for hours at a time,
 *    not milliseconds.
 * 3. History is *told* where the sessions step's ownership begins, rather
 *    than recomputing an equal-looking date from its own range. The two
 *    steps put different shapes into one `payload_json` column; the date
 *    that divides it is now a single value passed between them, so neither
 *    range can be changed later in a way that silently re-opens the seam.
 */
async function execute(options: RunPrefetchOptions): Promise<PrefetchRunOutcome> {
  const failed: PrefetchStepName[] = [];

  const now = options.now ?? new Date();
  // Never rejects, so it cannot cost the pass a step; resolves to the
  // device zone on a device whose local database will not open.
  const timeZone = options.timeZone ?? (await ensureClientTimeZoneHydrated());
  const upcoming = upcomingRange(now, timeZone);

  if (!(await runStep('sessions', () => prefetchSessionsAndExercises({ now, timeZone })))) {
    failed.push('sessions');
  }
  if (!(await runStep('foods', () => prefetchFoods()))) {
    failed.push('foods');
  }
  if (
    !(await runStep('history', () =>
      prefetchHistory({ now, timeZone, upcomingOwnsFrom: upcoming.from }),
    ))
  ) {
    failed.push('history');
  }

  return { status: 'completed', failed };
}

/**
 * `CLAUDE.md` §11.2's prefetch, as one call: today's and tomorrow's
 * sessions with their exercises, the most-used foods, the trailing 30 days.
 *
 * Single-flight, and a second caller **joins** the running pass rather than
 * being turned away — the same shape as `flushOutbox` (`outbox/02`), and the
 * reason a foreground burst cannot stack two runs.
 *
 * Never throws, so a fire-and-forget caller cannot produce an unhandled
 * rejection, and never blocks: the synchronous part is three store reads.
 */
export function runPrefetch(options: RunPrefetchOptions = {}): Promise<PrefetchRunOutcome> {
  if (inFlight) return inFlight;

  const reason = skipReason();
  if (reason) return Promise.resolve({ status: 'skipped', reason });

  lastRunStartedAtMs = Date.now();
  const running = execute(options).finally(() => {
    inFlight = null;
  });
  inFlight = running;
  return running;
}

let subscription: { remove: () => void } | null = null;
let unsubscribeAuth: (() => void) | null = null;

function onForeground(): void {
  if (!useConnectivityStore.getState().isConnected) return;

  // `offline-sync` §4's second flush trigger, alongside `connectivity/02`'s
  // regain. Unthrottled and independent of the prefetch below: it is the
  // client's own unsynced work, and it is single-flight, so a foreground
  // landing on a running flush joins it.
  void flushOutbox().catch((error: unknown) => {
    console.warn('prefetch.foreground_flush_failed', {
      errorCode: getErrorCode(error) ?? 'UNEXPECTED',
    });
  });

  if (Date.now() - lastRunStartedAtMs < PREFETCH_MIN_INTERVAL_MS) return;
  void runPrefetch();
}

/**
 * The cold-start pass. A launch is the app's first foreground, but `AppState`
 * emits no `'change'` for it, so without this a freshly launched app has
 * nothing cached until the user backgrounds and returns.
 *
 * It waits for the auth bootstrap rather than reading `status` once: at the
 * module scope this is called from, the session is still `'loading'` and the
 * gate would skip every time. One shot — a sign-in later in the session is
 * covered by the next foreground, not by a permanent subscriber.
 */
function runAfterSessionResolves(): void {
  if (useAuthStore.getState().status !== 'loading') {
    onForeground();
    return;
  }
  unsubscribeAuth = useAuthStore.subscribe((state) => {
    if (state.status === 'loading') return;
    unsubscribeAuth?.();
    unsubscribeAuth = null;
    onForeground();
  });
}

/**
 * `CLAUDE.md` §11.2's trigger: prefetch on app foreground, with connectivity.
 *
 * Fires on the transition **into** `'active'` only. `AppState` repeats
 * `'active'` for events that never left the foreground, and re-running on
 * each is the waste `PREFETCH_MIN_INTERVAL_MS` exists to bound anyway.
 *
 * Idempotent, and called once at app start (`app/_layout.tsx`) rather than
 * from a component: this subscriber has to outlive every screen, and an
 * effect would re-register it on a layout remount.
 */
export function ensurePrefetchOnForeground(): void {
  if (subscription) return;

  // So the connectivity gate reads a real value before any component has
  // mounted `useConnectivity` (same reason `ensureFlushOnRegain` does it).
  ensureConnectivityTracking();

  let previous: AppStateStatus = AppState.currentState;
  subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
    const wasForeground = previous === 'active';
    previous = next;
    if (next !== 'active' || wasForeground) return;
    onForeground();
  });

  runAfterSessionResolves();
}

/** Test-only teardown — mirrors `resetFlushOnRegainForTests`. */
export function resetPrefetchSchedulerForTests(): void {
  subscription?.remove();
  subscription = null;
  unsubscribeAuth?.();
  unsubscribeAuth = null;
  inFlight = null;
  lastRunStartedAtMs = 0;
}
