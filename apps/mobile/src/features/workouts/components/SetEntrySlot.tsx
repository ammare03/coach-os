import { Text, hapticSetLogged } from '@coachos/ui';
import { spacing, useTheme } from '@coachos/ui/theme';
import { parseWeight, resolveWeightStep, type WeightUnit } from '@coachos/utils';
import { and, asc, eq } from 'drizzle-orm';
import { AlertTriangle } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { getLocalDb } from '../../../db/client.ts';
import { localSetLogs } from '../../../db/schema/local-training.ts';
import { useWeightUnit } from '../../../hooks/useWeightUnit.ts';
import type { LocalSessionPayload } from '../../../lib/prefetch/sessions.ts';
import { useExerciseTarget } from '../hooks/useExerciseTarget.ts';
import { useLogSet } from '../hooks/useLogSet.ts';
import type { ExercisePage } from '../lib/exercise-pages.ts';

import { NearestWeightLine, PlateStack } from './PlateStack.tsx';
import { PreviousSetLine, speakPreviousSetLine } from './PreviousSetLine.tsx';
import { SET_ENTRY_COPY, SetEntryRow, speakLoad, toDisplayWeight } from './SetEntryRow.tsx';
import { renderSetTrailing, speakSetTrailing } from './SetFlagChips.tsx';
import { SetList } from './SetList.tsx';
import type { LoggedSetView } from './SetRow.tsx';

// `set-entry/01` — the slot `session-runtime/03` left under the target
// line, and everything that happens between the client's second tap and the
// row appearing.
//
// **The shape is a list that gives way and a card that does not.** The list
// is `flex: 1, minHeight: 0`; the composer is `flexShrink: 0`. On a 393pt
// frame that is 205px of card and about 60px of list — see `SetEntryRow`'s
// header for why the card's height is the load-bearing property of the
// whole design.
//
// **The <100ms budget is met by doing nothing.** §19 measures tap → visual
// confirmation, and the confirmation is entirely local:
//
//   - `tapAtMs` is `Date.now()` on the first line of the handler, so
//     `set_logged.entry_ms` measures the real thing rather than this
//     component's own overhead.
//   - The head becomes "Set 4" **synchronously, in the same tick as the
//     tap** — `inFlight` is bumped before anything is awaited. The card
//     does not re-layout: every band is a fixed minimum and no value moves,
//     so the confirmation costs zero layout passes. That is the 0ms the
//     design asks for.
//   - The row lands when `useLogSet`'s two SQLite writes resolve. No tRPC
//     is awaited anywhere on this path (`useLogSet` rule (a)), so online and
//     offline are byte-for-byte the same code path and must look identical.
//
// **The set number cannot collide under a fast thumb.** It is
// `max(working) + workingInFlight + 1`, so a client double-tapping the
// confirm before the first write resolves gets 3 and 4, never 3 and 3 — and
// a rejected write hands its number straight back.
//
// **A warm-up takes no number on either side of that sum** (`set-entry/04`).
// It is excluded from `max` and it never bumps `workingInFlight`, so three
// warm-ups then a working set makes the working set set 1 — which is what a
// set number means, and what DB§22's `is_warmup = false` filter assumes one
// row further down. The warm-up row still carries the number it sat before
// (the schema's floor is 1), but nothing reads it: `SetRow` prints `W` and
// `readPreviousSession` drops it from the per-set grain.
//
// ==================== WHAT A CONFIRM DOES TO THE FLAGS ==================
//
// **Warm-up persists; to-failure clears.** They are not the same kind of
// fact, so they cannot have the same lifetime:
//
//   - Warm-up describes a PHASE. Nobody does one warm-up set. Clearing it
//     would charge a client a chip tap per set through the exact stretch of
//     the session where sets come fastest; persisting costs two taps for a
//     ramp of any length — on, then off. The composer keeps saying so while
//     it is on (the head label stays dropped), so it is never a silent mode.
//   - To-failure describes ONE SET'S OUTCOME, and the next set is not it.
//     Persisting would quietly mark every following set as taken to failure
//     — the product asserting something about a client that is not true, in
//     the data their coach reads (`COPY.md` §CO2). A false positive here is
//     worse than the one tap it costs on the rare set that earns the flag.
//
// Neither affects §8.4: both start `false`, and the clear happens after the
// confirm, never between the stepper and it.

/** Neither a target nor a history to seed from: the stepper's own floor, not a guess. */
const REPS_FALLBACK = 1;

export interface SetEntrySlotProps {
  page: ExercisePage;
  /** The live prescription mirror, for the pre-fill. Task 09's snapshot seam. */
  payload: LocalSessionPayload | null;
  /** `local_workout_sessions.client_local_id` — the id the logger route carries. */
  sessionLocalId: string;
}

export function SetEntrySlot({ page, payload, sessionLocalId }: SetEntrySlotProps) {
  const theme = useTheme();
  const unit = useWeightUnit();
  const { logSet } = useLogSet();
  const { target, history } = useExerciseTarget({ page, payload, sessionLocalId });

  const exerciseId = page.exerciseId;
  const [sets, setSets] = useState<readonly LoggedSetView[]>([]);
  /** Working sets only — a warm-up claims no number, so it reserves none. */
  const [workingInFlight, setWorkingInFlight] = useState(0);
  const [enteringLocalId, setEnteringLocalId] = useState<string | null>(null);
  const [hasFailed, setHasFailed] = useState(false);

  // What this exercise already holds in this session. A client who force-
  // quits mid-workout and comes back must see their sets and must not start
  // numbering at 1 again — the same reason `useLogSet` keeps the session's
  // outbox parent on the row rather than in memory.
  const readKey = `${exerciseId}\u0000${sessionLocalId}`;
  const [seeded, setSeeded] = useState<{ key: string; rows: readonly LoggedSetView[] } | null>(
    null,
  );

  useEffect(() => {
    let alive = true;

    void (async () => {
      try {
        const db = await getLocalDb();
        const rows = await db
          .select({
            clientLocalId: localSetLogs.clientLocalId,
            setNumber: localSetLogs.setNumber,
            reps: localSetLogs.reps,
            weightKg: localSetLogs.weightKg,
            isWarmup: localSetLogs.isWarmup,
            // Read back, not only written: a client who logs a set to
            // failure and force-quits must find it still flagged when the
            // session reloads from this mirror (`set-entry/04`).
            isFailure: localSetLogs.isFailure,
            loggedAt: localSetLogs.loggedAt,
          })
          .from(localSetLogs)
          .where(
            and(
              eq(localSetLogs.sessionLocalId, sessionLocalId),
              eq(localSetLogs.exerciseId, exerciseId),
            ),
          )
          .orderBy(asc(localSetLogs.setNumber));

        if (!alive) return;
        setSeeded({
          key: readKey,
          rows: rows.map((row) => ({
            localId: row.clientLocalId,
            setNumber: row.setNumber,
            // A row with no rep count is a timed or distance set; it is a
            // real row and it renders, it just has nothing to count.
            reps: row.reps ?? 0,
            weightKg: row.weightKg,
            loggedAt: new Date(row.loggedAt),
            isWarmup: row.isWarmup,
            isFailure: row.isFailure,
          })),
        });
      } catch {
        // Handled, not swallowed (`code-conventions` §8): an empty list is
        // the honest render of a cache we could not read, and the composer
        // below still works. Not reported — a cold cache must not put one
        // Sentry event on the board per page turn.
        if (alive) setSeeded({ key: readKey, rows: [] });
      }
    })();

    return () => {
      alive = false;
    };
  }, [readKey, sessionLocalId, exerciseId]);

  // Derived during render rather than reset in an effect, so a page turn can
  // never show the previous exercise's sets for one frame under this
  // exercise's name (`useExerciseTarget` makes the identical argument).
  const seedRows = seeded !== null && seeded.key === readKey ? seeded.rows : EMPTY_ROWS;
  const logged = useMemo(
    () => [...seedRows, ...sets].sort((a, b) => a.setNumber - b.setNumber),
    [seedRows, sets],
  );

  const setNumber = highestWorkingSetNumber(logged) + workingInFlight + 1;

  // `set-entry/04`. Keyed on the exercise and session rather than reset in
  // an effect, for the reason the draft below gives: a page turn must not
  // show the previous exercise's flags for one frame under this exercise's
  // name. NOT keyed on the unit — a flag is not a measurement.
  const [flags, setFlags] = useState<DraftFlags | null>(null);
  const { isWarmup, isFailure } = liveFlags(flags, readKey);

  const handleWarmupChange = useCallback(
    (next: boolean) => {
      setFlags((current) => ({
        key: readKey,
        isWarmup: next,
        isFailure: liveFlags(current, readKey).isFailure,
      }));
    },
    [readKey],
  );

  const handleFailureChange = useCallback(
    (next: boolean) => {
      setFlags((current) => ({
        key: readKey,
        isWarmup: liveFlags(current, readKey).isWarmup,
        isFailure: next,
      }));
    },
    [readKey],
  );

  // `set-entry/02`. Both fields ride in on the payload the pager already
  // holds — `workouts.upcoming` returns the exercise cache beside the
  // prescription — so the plate block costs no second read
  // (`screen-composition`'s waterfall rule). A page whose library row
  // missed (a cold cache mid-gym) degrades to the column defaults rather
  // than refusing to render.
  const exercise = payload?.exercises.find((candidate) => candidate.id === exerciseId);
  const equipment = exercise?.equipment ?? null;

  // The increment is native to the unit — 2.5kg converted to lb is an
  // unusable 5.5lb step. `resolveWeightStep` composes the coach's increment
  // with the unit's own grid and owns the 2.5 default and the zero/negative
  // cases, so nothing here re-checks them (DB§5.2).
  const weightStep = resolveWeightStep(exercise?.defaultIncrementKg, unit);

  const last = history.kind === 'ready' ? history.last : null;
  const lastInSession = logged.length === 0 ? null : logged[logged.length - 1];

  // The pre-fill, in priority order, so the common case really is "glance,
  // maybe adjust once, confirm" (task Approach step 1):
  //
  //   1. the set this client just did, in this session — set 2 onward
  //   2. what they did last time
  //   3. what their coach asked for
  //
  // Recomputed when the unit changes, which is why `unit` is in the draft
  // key below: a pinned display value would be a pound number labelled kg.
  const prefill = useMemo(
    () => ({
      weight:
        toDisplayWeight(
          lastInSession?.weightKg ?? last?.weightKg ?? target?.targetWeightKg ?? null,
          unit,
        ) ?? 0,
      reps: lastInSession?.reps ?? target?.targetRepsMin ?? last?.reps ?? REPS_FALLBACK,
    }),
    [lastInSession, last, target, unit],
  );

  const draftKey = `${readKey}\u0000${unit}`;
  const [draft, setDraft] = useState<{ key: string; weight: number; reps: number } | null>(null);
  const isDraftLive = draft !== null && draft.key === draftKey;
  const weight = isDraftLive ? draft.weight : prefill.weight;
  const reps = isDraftLive ? draft.reps : prefill.reps;

  const handleWeightChange = useCallback(
    (next: number) => {
      setDraft({ key: draftKey, weight: next, reps });
    },
    [draftKey, reps],
  );

  const handleRepsChange = useCallback(
    (next: number) => {
      setDraft({ key: draftKey, weight, reps: next });
    },
    [draftKey, weight],
  );

  // The plate block reads kilograms and the stepper holds the client's
  // display unit, so the edge is crossed here and in `handleConfirm` and
  // nowhere else (`CLAUDE.md` §0). A stepper reading 0 resolves to a bare
  // bar the ask cannot reach, which `resolvePlateStack` suppresses.
  const weightKg = parseWeight(weight, unit);

  const handleSelectNearest = useCallback(
    (nextKg: number) => {
      setDraft({ key: draftKey, weight: toDisplayWeight(nextKg, unit) ?? 0, reps });
    },
    [draftKey, unit, reps],
  );

  const handleConfirm = useCallback(() => {
    // First line, before any work: this is what `set_logged.entry_ms`
    // measures against, and it is how §19's budget gets proven in the field
    // rather than on a desk.
    const tapAtMs = Date.now();
    const number = setNumber;
    // Read once, here: everything below describes the set as it was at the
    // tap, not as the chips read by the time the write resolves.
    const wasWarmup = isWarmup;
    const wasFailure = isFailure;

    // `Light`, once, on create — the only haptic on this surface
    // (`ui-conventions` §5). A warm-up is logged work and gets the same one.
    // Fire-and-forget; it never gates the write.
    hapticSetLogged();

    // Synchronous, same tick as the tap: the head reads "Set 4" before the
    // frame is drawn, and the number is claimed so a second tap cannot take
    // it. Nothing re-layouts — no band changes size.
    // A warm-up claims nothing, so two fast warm-up taps both log as the
    // same (unread) number rather than skipping the client's set 1.
    if (!wasWarmup) setWorkingInFlight((count) => count + 1);
    setHasFailed(false);

    // Cleared in the same tick the number is claimed, and for the same
    // reason — see the header. Warm-up is deliberately left alone.
    if (wasFailure) handleFailureChange(false);

    // The one place this feature crosses the unit edge (`CLAUDE.md` §0).
    // Below the stepper's own floor there is no external load, which is a
    // bodyweight set, not a 0kg lift.
    const weightKg = weight === 0 ? null : parseWeight(weight, unit);

    void (async () => {
      try {
        const result = await logSet({
          sessionLocalId,
          exerciseId,
          setNumber: number,
          reps,
          weightKg,
          tapAtMs,
          isWarmup: wasWarmup,
          isFailure: wasFailure,
        });

        setSets((current) => [
          ...current,
          {
            localId: result.localId,
            setNumber: result.setNumber,
            reps,
            weightKg,
            loggedAt: result.loggedAt,
            isWarmup: wasWarmup,
            isFailure: wasFailure,
          },
        ]);
        setEnteringLocalId(result.localId);
        // An optimistic write is invisible to a screen reader otherwise
        // (`accessibility` §2) — the row appears with no sound at all. A
        // warm-up names itself rather than a set number it does not hold,
        // the same substitution the confirm's own label makes.
        const load = speakConfirmed(weightKg, reps, unit);
        AccessibilityInfo.announceForAccessibility(
          wasWarmup
            ? SET_ENTRY_COPY.warmupLoggedAnnouncement(load)
            : SET_ENTRY_COPY.loggedAnnouncement(result.setNumber, load),
        );
      } catch {
        // `useLogSet` rejects on exactly one thing: a local-mirror fault —
        // no such session on this device, or a session that is not in
        // progress. There is no network outcome to handle here, so this is
        // never phrased as one.
        setHasFailed(true);
        // The tap is undone whole, not in part: the set number goes back
        // below and the flag that described the refused set comes back with
        // it, so a retry does not silently drop it. Read through the
        // updater rather than `wasWarmup`, so a warm-up toggled while the
        // write was in flight survives.
        if (wasFailure) handleFailureChange(true);
      } finally {
        // Hands the set number straight back on failure; on success the
        // appended row has already taken it, so the head never skips.
        if (!wasWarmup) setWorkingInFlight((count) => count - 1);
      }
    })();
  }, [
    setNumber,
    weight,
    reps,
    unit,
    logSet,
    sessionLocalId,
    exerciseId,
    isWarmup,
    isFailure,
    handleFailureChange,
  ]);

  useEffect(() => {
    if (!hasFailed) return;
    AccessibilityInfo.announceForAccessibility(SET_ENTRY_COPY.failed);
  }, [hasFailed]);

  // `set-entry/03`. **Built once per set, not once per render.** `SetRow` is
  // memoised and this list re-renders on every stepper keystroke; a fresh
  // element here would be a new `trailing` prop each time and would defeat
  // that memo for twelve rows, mid-set, on the screen least able to afford
  // it (`frontend-performance` §3). The map recomputes only when a set is
  // logged or the history read resolves.
  //
  // **Task 04 resolves the priority here, not inside `SetRow`**: a flag tag
  // wins the slot, then this line, then nothing (design spec, "One slot,
  // two occupants"). `renderSetTrailing` owns that precedence — it is a
  // product rule and it has to match what `speakSetTrailing` says below.
  const trailingByLocalId = useMemo(() => {
    const nodes = new Map<string, ReactNode>();
    for (const row of logged) {
      nodes.set(
        row.localId,
        renderSetTrailing(
          row,
          <PreviousSetLine
            history={history}
            setNumber={row.setNumber}
            unit={unit}
            placement="row"
            testID={`set-row-previous-${row.localId}`}
          />,
          `set-row-flag-${row.localId}`,
        ),
      );
    }
    return nodes;
  }, [logged, history, unit]);

  const renderTrailing = useCallback(
    (row: LoggedSetView) => trailingByLocalId.get(row.localId) ?? null,
    [trailingByLocalId],
  );

  // A string compares by value, so this one needs no such cache. Same
  // priority, spoken — the two resolutions can only stay in step by going
  // through the same pair of helpers.
  const renderTrailingLabel = useCallback(
    (row: LoggedSetView) =>
      speakSetTrailing(row, speakPreviousSetLine(history, row.setNumber, unit)),
    [history, unit],
  );

  return (
    <View style={styles.slot}>
      <SetList
        sets={logged}
        unit={unit}
        enteringLocalId={enteringLocalId}
        renderTrailing={renderTrailing}
        renderTrailingLabel={renderTrailingLabel}
        testID="set-list"
      />

      {hasFailed ? (
        // Above the card, where the client's thumb already is — never a
        // toast (it dismisses itself over this exact control) and never a
        // full error state (the session and every logged set are still on
        // screen and still fine). It takes its height from the LIST, not
        // from the card, so the confirm does not move.
        <View
          style={styles.message}
          accessible
          accessibilityRole="alert"
          accessibilityLabel={SET_ENTRY_COPY.failed}
          testID="set-entry-error"
        >
          {/* Warm, never `urgent`: red in this product means missed or
              overdue, and a refused tap is not an adherence signal
              (`DESIGN.md` §8). The glyph is the second channel, so the
              message never rests on hue alone. */}
          <AlertTriangle size={15} color={theme.colors.fg.warm} strokeWidth={2} />
          <Text size="body-sm" tone="warm" style={styles.messageText}>
            {SET_ENTRY_COPY.failed}
          </Text>
        </View>
      ) : null}

      <View style={styles.composer}>
        <SetEntryRow
          mode="create"
          setNumber={setNumber}
          weight={weight}
          reps={reps}
          unit={unit}
          weightStep={weightStep}
          onWeightChange={handleWeightChange}
          onRepsChange={handleRepsChange}
          onConfirm={handleConfirm}
          // The head band's trailing seam. Supplying both handlers is what
          // mounts the chips; neither sits between the steppers and the
          // confirm, so the default working set is still two taps (§8.4).
          isWarmup={isWarmup}
          isFailure={isFailure}
          onWarmupChange={handleWarmupChange}
          onFailureChange={handleFailureChange}
          // Left of the band; `PreviousSetLine` takes the right.
          // `PlateStack` draws an empty view rather than nothing when it
          // does not apply, so that slot keeps its place under
          // `space-between`.
          contextLeading={<PlateStack equipment={equipment} weightKg={weightKg} unit={unit} />}
          // Right of the band, against the set number being composed — so
          // a client about to log set 4 reads set 4's own history, or
          // "no set 4 last time" when the previous session stopped at 3.
          // Renders nothing at all while the read is in flight: the band
          // keeps its 20px either way, so the confirm does not move.
          contextTrailing={
            <PreviousSetLine
              history={history}
              setNumber={setNumber}
              unit={unit}
              placement="composer"
              testID="set-entry-previous"
            />
          }
          // Mounted unconditionally — it returns null unless the weight is
          // off the plate grid, and that is the one case the card is
          // allowed to grow for (205 → 229, resolved in one tap).
          contextBelow={
            <NearestWeightLine
              equipment={equipment}
              weightKg={weightKg}
              unit={unit}
              onSelectNearest={handleSelectNearest}
            />
          }
          testID="set-entry-row"
        />
      </View>
    </View>
  );
}

/** Stable identity, so the `useMemo` below it does not rebuild on every render. */
const EMPTY_ROWS: readonly LoggedSetView[] = [];

/** The composer's two flags, and the exercise-and-session they belong to. */
interface DraftFlags {
  key: string;
  isWarmup: boolean;
  isFailure: boolean;
}

/** Both off — a page this composer has not been touched on, and the default. */
const NO_FLAGS = { isWarmup: false, isFailure: false } as const;

/**
 * The flags as they apply to `key`, or both off. Derived rather than reset
 * in an effect, so a page turn can never show the previous exercise's flags
 * for one frame under this exercise's name.
 */
function liveFlags(flags: DraftFlags | null, key: string): Omit<DraftFlags, 'key'> {
  return flags !== null && flags.key === key ? flags : NO_FLAGS;
}

/**
 * `max`, never `length`: task 06 deletes a set without renumbering the rest.
 *
 * **Warm-ups are skipped** (task 04). A warm-up occupies no set number, so
 * a ramp of three followed by the first working set makes that set 1 — the
 * same thing `readPreviousSession` assumes when it drops warm-ups from the
 * per-set grain, and what DB§22's filter means one row further down.
 */
function highestWorkingSetNumber(sets: readonly LoggedSetView[]): number {
  let highest = 0;
  for (const set of sets) {
    if (!set.isWarmup && set.setNumber > highest) highest = set.setNumber;
  }
  return highest;
}

/** The spoken load for the announcement — kilograms in, the client's unit out. */
function speakConfirmed(weightKg: number | null, reps: number, unit: WeightUnit): string {
  return speakLoad(toDisplayWeight(weightKg, unit), reps, unit);
}

const styles = StyleSheet.create({
  slot: {
    flex: 1,
    minHeight: 0,
    gap: spacing(8),
  },
  composer: {
    flexShrink: 0,
  },
  message: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing(6),
    flexShrink: 0,
  },
  messageText: {
    flex: 1,
    minWidth: 0,
  },
});
