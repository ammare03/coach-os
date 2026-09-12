import { LIGHT_SCHEME_AVAILABLE, type Scheme } from '@coachos/ui';
import { eq } from 'drizzle-orm';
import { useEffect } from 'react';
import { create } from 'zustand';

import { getLocalDb, type LocalDb } from '../../../db/client.ts';
import { meta } from '../../../db/schema/sync.ts';

// `phase-09-workout-logger/settings-shell/03` — the device-local scheme
// preference, and the seam `phase-22-release-engineering/light-scheme/02`
// turns Light on through.
//
// Five decisions, in the order they matter:
//
// (a) **Dark on the very first frame, in every code path.** The default
//     below is a value, not a pending state, and `ThemeProvider` is handed
//     it synchronously at the root (`app/_layout.tsx`). The stored
//     preference is read asynchronously and applied when it resolves.
//     Reading SQLite on the startup path to avoid that swap would block
//     first paint (`CLAUDE.md` §19) for a value that today can only be
//     `'dark'` — there is nothing to wait for. `isReady` exists so a caller
//     can tell "dark because that is the preference" from "dark because we
//     have not looked yet"; nothing may use it to withhold a frame.
//
// (b) **`meta`, not `expo-secure-store` and not the query cache.** Secure
//     store is tokens only (`CLAUDE.md` §3.1) and the query cache is server
//     state with a 24h `maxAge`. DB§13's `meta` already holds this
//     database's singleton facts — `schema_version`, `user_id`,
//     `rest_timer` — and a display preference is exactly that shape. No
//     column, no migration, no `DATABASE.md` amendment, and no export or
//     purge entry for something that is not a fact about a person.
//
// (c) **It goes with the mirror at sign-out, and that is the chosen
//     behaviour.** `local-database/03` deletes the file, so the next
//     sign-in starts dark. Ammar picked that over a server column; the test
//     documents it so nobody later reads it as a bug.
//
// (d) **`'light'` is refused HERE, not only in the UI.** A dimmed segment
//     stops a finger. It does not stop a deep link, a test fixture, or a
//     future caller — and what is on the other side of that mistake is the
//     undesigned fallback scheme in front of a real user. The setter and
//     the read both go through {@link isAvailableScheme}, so there is one
//     rule rather than two that can drift.
//
// (e) **A corrupt value falls back to dark, silently.** There is no screen
//     worth showing for an unreadable display preference, and no message a
//     person could act on. It is not an error; it is an absence.

/** DB§13's `meta` key this file owns. `schema_version`, `user_id` and `rest_timer` are the neighbours. */
export const APPEARANCE_META_KEY = 'appearance';

/** `DESIGN.md` §1.1's only designed palette, and therefore the only value the app can reach today. */
export const DEFAULT_SCHEME: Scheme = 'dark';

/**
 * Whether this build may put a user on `value`.
 *
 * `'light'` is a real `Scheme` the type system accepts and this build must
 * not hand to anyone — decision (d). `light-scheme/02` deletes the second
 * branch.
 */
export function isAvailableScheme(value: unknown): value is Scheme {
  if (value === 'dark') return true;
  if (value === 'light') return LIGHT_SCHEME_AVAILABLE;
  return false;
}

/**
 * The stored string as a scheme this build can honour, or dark — decision
 * (e). Absent, misspelt, JSON, or a scheme a later build wrote and this one
 * cannot render all resolve the same way.
 */
export function parseScheme(stored: string | null | undefined): Scheme {
  return isAvailableScheme(stored) ? stored : DEFAULT_SCHEME;
}

interface AppearanceState {
  scheme: Scheme;
  /** The stored preference has been read (or has failed, which is the same answer). Never gates a frame — decision (a). */
  isReady: boolean;
}

// Zustand, not TanStack Query: this is UI state that happens to be durable,
// not server state (`CLAUDE.md` §3.1, `code-conventions` §5). No `persist`
// middleware — that writes to a storage adapter of its own, and the whole
// point of (b) and (c) is that this row lives and dies with the mirror.
const useAppearanceStore = create<AppearanceState>(() => ({
  scheme: DEFAULT_SCHEME,
  isReady: false,
}));

/**
 * One chain for the whole app, the `rest-timer-persistence.ts` idiom: the
 * preference is a single row and two writes must not interleave. Failures
 * are swallowed into the chain so one rejected write cannot strand the ones
 * behind it.
 */
let pendingWrite: Promise<void> = Promise.resolve();

function enqueueWrite(scheme: Scheme): void {
  pendingWrite = pendingWrite
    .then(async () => {
      const db = await getLocalDb();
      await db
        .insert(meta)
        .values({ key: APPEARANCE_META_KEY, value: scheme })
        .onConflictDoUpdate({ target: meta.key, set: { value: scheme } });
    })
    .catch((error: unknown) => {
      // A code and the shape of the failure, never a value
      // (`observability-ops` §1). The cost is a preference that does not
      // survive a relaunch, which is a comfort, not the workout.
      console.warn('settings.appearance_persist_failed', {
        errorName: error instanceof Error ? error.name : 'unknown',
      });
    });
}

/**
 * Applies a scheme and writes it through.
 *
 * A no-op for anything this build cannot honour — decision (d), and the
 * only way out of this function that writes nothing.
 *
 * The write happens even when `next` is the scheme already in effect.
 * `meta.appearance` records a CHOICE, not a diff: today dark is both the
 * default and the only option, so skipping the write would leave a user who
 * deliberately chose dark indistinguishable from one who never opened
 * settings — and once `light-scheme/02` lands, that difference is the whole
 * preference. The state update is skipped instead, so re-selecting the
 * current option costs one idempotent upsert and no re-render.
 */
export function setScheme(next: Scheme): void {
  if (!isAvailableScheme(next)) return;
  if (useAppearanceStore.getState().scheme !== next) {
    useAppearanceStore.setState({ scheme: next });
  }
  enqueueWrite(next);
}

export interface LoadAppearanceDeps {
  db?: LocalDb;
}

let loading: Promise<Scheme> | null = null;

/**
 * Reads the stored preference once per process and applies whatever
 * survives {@link parseScheme}.
 *
 * Memoised and never rejecting, the same shape `ensureRestTimerPersistence`
 * uses: a second caller gets the first call's answer, and a mirror that
 * will not answer resolves to dark rather than throwing into a render.
 */
export function ensureAppearanceLoaded(deps: LoadAppearanceDeps = {}): Promise<Scheme> {
  if (loading) return loading;

  loading = readStoredScheme(deps)
    .catch((error: unknown): Scheme => {
      console.warn('settings.appearance_read_failed', {
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      return DEFAULT_SCHEME;
    })
    .then((scheme) => {
      useAppearanceStore.setState({ scheme, isReady: true });
      return scheme;
    });

  return loading;
}

async function readStoredScheme(deps: LoadAppearanceDeps): Promise<Scheme> {
  const db = deps.db ?? (await getLocalDb());
  const [row] = await db
    .select({ value: meta.value })
    .from(meta)
    .where(eq(meta.key, APPEARANCE_META_KEY))
    .limit(1);
  return parseScheme(row?.value);
}

export interface UseAppearance {
  /** Always a `Scheme`, from the first render onwards — decision (a). Never `undefined`, never a value this build cannot render. */
  scheme: Scheme;
  setScheme: (next: Scheme) => void;
  isReady: boolean;
}

/**
 * `{ scheme, setScheme, isReady }` — the preference, as a hook.
 *
 * Two subscriptions rather than one object selector: a selector returning a
 * fresh object re-renders every consumer on any store write, and one of
 * this hook's two consumers is the root layout (`frontend-performance` §3).
 */
export function useAppearance(): UseAppearance {
  const scheme = useAppearanceStore((state) => state.scheme);
  const isReady = useAppearanceStore((state) => state.isReady);

  // In an effect, not at module scope: an effect runs after the first
  // frame, which is the ordering decision (a) is made of, and it lands
  // after `local-database/04`'s schema gate has had its own first effect.
  useEffect(() => {
    void ensureAppearanceLoaded();
  }, []);

  return { scheme, setScheme, isReady };
}

/** Test seam — resolves once every queued write has been attempted. */
export function flushAppearanceWrites(): Promise<void> {
  return pendingWrite;
}

/** Test-only teardown — forgets the memoised read, the write chain, and the applied scheme. */
export function resetAppearanceForTests(): void {
  loading = null;
  pendingWrite = Promise.resolve();
  useAppearanceStore.setState({ scheme: DEFAULT_SCHEME, isReady: false });
}
