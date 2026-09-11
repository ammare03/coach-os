import { Text, hapticSetLogged } from '@coachos/ui';
import { spacing, useTheme } from '@coachos/ui/theme';
import { parseWeight, resolveWeightStepKg, weightStepFor, type WeightUnit } from '@coachos/utils';
import { and, asc, eq } from 'drizzle-orm';
import { AlertTriangle } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { getLocalDb } from '../../../db/client.ts';
import { localSetLogs } from '../../../db/schema/local-training.ts';
import { useWeightUnit } from '../../../hooks/useWeightUnit.ts';
import type { LocalSessionPayload } from '../../../lib/prefetch/sessions.ts';
import { useExerciseTarget } from '../hooks/useExerciseTarget.ts';
import { useLogSet } from '../hooks/useLogSet.ts';
import type { ExercisePage } from '../lib/exercise-pages.ts';

import { NearestWeightLine, PlateStack } from './PlateStack.tsx';
import { SET_ENTRY_COPY, SetEntryRow, speakLoad, toDisplayWeight } from './SetEntryRow.tsx';
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
// `max(logged) + inFlight + 1`, so a client double-tapping the confirm
// before the first write resolves gets 3 and 4, never 3 and 3 — and a
// rejected write hands its number straight back.

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
  const [inFlight, setInFlight] = useState(0);
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

  const setNumber = highestSetNumber(logged) + inFlight + 1;

  // `set-entry/02`. Both fields ride in on the payload the pager already
  // holds — `workouts.upcoming` returns the exercise cache beside the
  // prescription — so the plate block costs no second read
  // (`screen-composition`'s waterfall rule). A page whose library row
  // missed (a cold cache mid-gym) degrades to the column defaults rather
  // than refusing to render.
  const exercise = payload?.exercises.find((candidate) => candidate.id === exerciseId);
  const equipment = exercise?.equipment ?? null;

  // The increment is native to the unit — 2.5kg converted to lb is an
  // unusable 5.5lb step. `resolveWeightStepKg` owns the 2.5 default and the
  // zero/negative cases, so nothing here re-checks them (DB§5.2).
  const weightStep =
    unit === 'kg' ? resolveWeightStepKg(exercise?.defaultIncrementKg) : weightStepFor(unit);

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

    // `Light`, once, on create — the only haptic on this surface
    // (`ui-conventions` §5). Fire-and-forget; it never gates the write.
    hapticSetLogged();

    // Synchronous, same tick as the tap: the head reads "Set 4" before the
    // frame is drawn, and the number is claimed so a second tap cannot take
    // it. Nothing re-layouts — no band changes size.
    setInFlight((count) => count + 1);
    setHasFailed(false);

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
        });

        setSets((current) => [
          ...current,
          {
            localId: result.localId,
            setNumber: result.setNumber,
            reps,
            weightKg,
            loggedAt: result.loggedAt,
            isWarmup: false,
          },
        ]);
        setEnteringLocalId(result.localId);
        // An optimistic write is invisible to a screen reader otherwise
        // (`accessibility` §2) — the row appears with no sound at all.
        AccessibilityInfo.announceForAccessibility(
          SET_ENTRY_COPY.loggedAnnouncement(result.setNumber, speakConfirmed(weightKg, reps, unit)),
        );
      } catch {
        // `useLogSet` rejects on exactly one thing: a local-mirror fault —
        // no such session on this device, or a session that is not in
        // progress. There is no network outcome to handle here, so this is
        // never phrased as one.
        setHasFailed(true);
      } finally {
        // Hands the set number straight back on failure; on success the
        // appended row has already taken it, so the head never skips.
        setInFlight((count) => count - 1);
      }
    })();
  }, [setNumber, weight, reps, unit, logSet, sessionLocalId, exerciseId]);

  useEffect(() => {
    if (!hasFailed) return;
    AccessibilityInfo.announceForAccessibility(SET_ENTRY_COPY.failed);
  }, [hasFailed]);

  return (
    <View style={styles.slot}>
      <SetList sets={logged} unit={unit} enteringLocalId={enteringLocalId} testID="set-list" />

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
          // Left of the band; `PreviousSetLine` takes the right in task 03.
          // `PlateStack` draws an empty view rather than nothing when it
          // does not apply, so that slot keeps its place under
          // `space-between`.
          contextLeading={<PlateStack equipment={equipment} weightKg={weightKg} />}
          // Mounted unconditionally — it returns null unless the weight is
          // off the plate grid, and that is the one case the card is
          // allowed to grow for (205 → 229, resolved in one tap).
          contextBelow={
            <NearestWeightLine
              equipment={equipment}
              weightKg={weightKg}
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

/**
 * `max`, never `length`: task 06 deletes a set without renumbering the rest,
 * and a warm-up (task 04) occupies no number at all.
 */
function highestSetNumber(sets: readonly LoggedSetView[]): number {
  let highest = 0;
  for (const set of sets) {
    if (set.setNumber > highest) highest = set.setNumber;
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
