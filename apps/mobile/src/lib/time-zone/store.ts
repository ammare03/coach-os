import { sql } from 'drizzle-orm';
import { create } from 'zustand';

import { getLocalDb } from '../../db/client.ts';

// **The one answer to "which timezone is this client's day boundary in".**
//
// It exists because there were three answers, and they disagreed
// (`docs/UNFORGET.md` S32). `lib/prefetch/sessions.ts` and
// `lib/prefetch/history.ts` each defaulted to the device zone and each
// called `new Date()` for itself, while `useTodaySession` resolved the day
// from the stored `users.timezone`. The two prefetchers share one
// `local_workout_sessions.payload_json` column and divide it by date, so
// any disagreement between writer and reader hands the Today card a
// `{ session, setLogs }` payload where it expects `{ session, exercises }`
// — the client keeps the row and loses the whole prescription.
//
// Three decisions, in the order they matter:
//
// (a) **The stored `users.timezone` wins, not the device's.** That is the
//     product's definition of a client's day everywhere else it is
//     decided: `api/src/features/assignments/advance-assignment.ts` (b)
//     materialises sessions against the client's stored zone, and
//     `apps/api/src/routers/clientApp.ts` resolves `clientApp.history`'s
//     comment window from `ctx.user.timezone` and refuses to take a zone
//     off the wire at all. A device-zone day boundary would put the app's
//     "today" out of step with the server's "today" for the same client —
//     a traveller would see a day the assignment sweep has not reached.
//     `lib/prefetch/sessions.ts` rule (b) argued the opposite and is
//     superseded; what survives of it is that the device zone is the right
//     FALLBACK, which (c) covers.
//
// (b) **One resolver, called by the writer and the reader.** Not "the same
//     rule written down in two files" — that is what was there, and prose
//     is not a shared value. Background code (the prefetch scheduler) calls
//     `resolveClientTimeZone()`; components call `useClientTimeZone()`.
//     Both read this store, so they cannot answer differently at the same
//     instant. Same shape as `lib/connectivity/store.ts`, and for the same
//     reason: a second source reports the same fact at a different moment
//     and the app disagrees with itself.
//
// (c) **The device zone is the fallback, and on a first launch it is
//     almost always the right one.** `users.timezone` is seeded from
//     `Intl` at sign-up (`features/auth/hooks/useSignUp.ts`) and at invite
//     acceptance, so the two agree until the client travels or edits their
//     profile. Before anything has resolved the stored zone, both the
//     writer and the reader fall back here — together, which is what the
//     invariant actually requires.
//
// The `meta` row is what makes (c) rare rather than routine: the scheduler
// runs at module scope, long before any component has mounted `me.get`, so
// without a persisted copy every cold start would prefetch in the device
// zone and then be read in the stored one. `meta` is DB§13's existing home
// for exactly this shape of scalar and inherits the two behaviours that
// matter — the logout wipe and the schema-version drop both take it.

/** `meta.key` for the persisted copy. One row, overwritten whenever `me.get` answers. */
export const CLIENT_TIME_ZONE_META_KEY = 'client_time_zone';

interface ClientTimeZoneState {
  /** The client's stored `users.timezone`, or `null` until something resolves it. */
  stored: string | null;
  /** No-ops when the value is unchanged, so a re-publish notifies nobody. */
  setStored: (timeZone: string | null) => void;
}

export const useClientTimeZoneStore = create<ClientTimeZoneState>((set, get) => ({
  stored: null,
  setStored: (timeZone) => {
    if (get().stored === timeZone) return;
    set({ stored: timeZone });
  },
}));

/**
 * The client's zone as the device reports it. Only ever a fallback — see
 * decision (c). Kept as its own function so a test has a seam and so
 * nothing reaches into `Intl` mid-calculation.
 */
export function resolveDeviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * The non-hook form, for background code with no React around it. Cheap
 * and synchronous by design — the prefetch scheduler must not pay a
 * database read per step, and nothing on a render path may.
 */
export function resolveClientTimeZone(): string {
  return useClientTimeZoneStore.getState().stored ?? resolveDeviceTimeZone();
}

function persistClientTimeZone(timeZone: string): void {
  void getLocalDb()
    .then((db) => {
      db.run(
        sql`INSERT INTO meta (key, value) VALUES (${CLIENT_TIME_ZONE_META_KEY}, ${timeZone})
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      );
    })
    .catch(() => {
      // A cache write, not the source of truth. The in-memory value is
      // already correct for this session and `me.get` re-publishes on the
      // next launch; failing here costs one cold start's accuracy, never a
      // wrong write.
    });
}

/**
 * Records the authoritative zone. Called from `useClientTimeZone` when
 * `me.get` answers, and from nowhere else — a second publisher is a second
 * source, which is what decision (b) exists to prevent.
 *
 * Fire-and-forget: the store is updated synchronously so the very next
 * `resolveClientTimeZone()` is right, and the `meta` write trails it.
 */
export function publishClientTimeZone(timeZone: string): void {
  if (useClientTimeZoneStore.getState().stored === timeZone) return;
  useClientTimeZoneStore.getState().setStored(timeZone);
  persistClientTimeZone(timeZone);
}

let hydration: Promise<string> | null = null;

/**
 * Reads the persisted zone into the store, once per app run, and resolves
 * to whatever `resolveClientTimeZone()` will answer afterwards.
 *
 * Awaited by the prefetch steps rather than by anything that renders: it is
 * one indexed `SELECT` against a one-row table, but it is still a database
 * read and `CLAUDE.md` §19 does not have a frame to spend on it.
 *
 * Never rejects. A device whose local database will not open still has a
 * working fallback, and a prefetch pass that threw here would lose today's
 * session over a cache read.
 */
export function ensureClientTimeZoneHydrated(): Promise<string> {
  if (!hydration) {
    const hydrating = (async () => {
      // A published value is newer than anything on disk, so hydration
      // never overwrites one — it only fills the gap before `me.get`
      // has answered in this run.
      if (useClientTimeZoneStore.getState().stored !== null) return resolveClientTimeZone();
      try {
        const db = await getLocalDb();
        const row = db.get<{ value: string | null }>(
          sql`SELECT value FROM meta WHERE key = ${CLIENT_TIME_ZONE_META_KEY}`,
        );
        if (row?.value) useClientTimeZoneStore.getState().setStored(row.value);
      } catch {
        // Falls back to the device zone, which is what the caller would
        // have used anyway. Not an error state.
      }
      return resolveClientTimeZone();
    })();
    // Don't memoise a failure — same idiom as `db/client.ts` and
    // `lib/outbox/flush.ts`.
    hydrating.catch(() => {
      hydration = null;
    });
    hydration = hydrating;
  }
  return hydration;
}

/**
 * Forgets the current user's zone. Called on sign-out and on an
 * account switch, alongside the local-database wipe — the previous user's
 * day boundary must not decide the next user's first prefetch.
 */
export function resetClientTimeZone(): void {
  hydration = null;
  useClientTimeZoneStore.getState().setStored(null);
}

/** Test-only teardown — mirrors `resetPrefetchSchedulerForTests`. */
export function resetClientTimeZoneForTests(): void {
  resetClientTimeZone();
}
