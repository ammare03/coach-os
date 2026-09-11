import { NotFoundState, hapticSessionComplete } from '@coachos/ui';
import { createThemedStyles, density, spacing } from '@coachos/ui/theme';
import { useCallback, useContext, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { useWeightUnit } from '../../../hooks/useWeightUnit.ts';
import type { LocalSessionPayload } from '../../../lib/prefetch/sessions.ts';
import { useCompleteSession } from '../hooks/useCompleteSession.ts';
import { useExercisePosition } from '../hooks/useExercisePosition.ts';
import { useLoggerSession, type LoggerSessionState } from '../hooks/useLoggerSession.ts';
import { usePRCelebration } from '../hooks/usePRCelebration.ts';
import { useSessionHeartbeat } from '../hooks/useSessionHeartbeat.ts';
import { useSessionKeepAwake } from '../hooks/useSessionKeepAwake.ts';
import { useSessionRecords } from '../hooks/useSessionRecords.ts';
import { useSkipExercise } from '../hooks/useSkipExercise.ts';
import { useSwapExercise } from '../hooks/useSwapExercise.ts';
import { resolveAlternatives, type AlternativeExercise } from '../lib/alternatives.ts';
import { buildExercisePages, type ExercisePage } from '../lib/exercise-pages.ts';
import {
  selectSkips,
  useSkippedExercisesStore,
  type SkipReason,
  type SkippedExercise,
} from '../store/skipped-exercises-store.ts';
import {
  selectSubstitutions,
  useSubstitutedExercisesStore,
} from '../store/substituted-exercises-store.ts';

import { ExercisePager } from './ExercisePager.tsx';
import { LoggerHeader } from './LoggerHeader.tsx';
import { LoggerLoadError } from './LoggerLoadError.tsx';
import { LoggerNoPrescription } from './LoggerNoPrescription.tsx';
import { ProgramChangedNotice } from './ProgramChangedNotice.tsx';
import { RestTimerBar } from './RestTimerBar.tsx';
import { SessionFinish } from './SessionFinish.tsx';
import { SetEntrySlot } from './SetEntrySlot.tsx';
import { SkipExerciseSheet } from './SkipExerciseSheet.tsx';
import { SwapExerciseSheet } from './SwapExerciseSheet.tsx';
import { TargetLine } from './TargetLine.tsx';

// `(client)/workout/[sessionId]` — Pattern C, focus mode (`UI-UX.md` §UX2),
// client density. The container every later task in `session-runtime`
// renders inside.
//
// **No dock, and not by anything this file does.** `(client)/_layout.tsx`
// declares this route a sibling of `(tabs)` with `presentation:
// 'fullScreenModal'` and `gestureEnabled: false`, which is what removes the
// tab bar and the accidental swipe-to-dismiss mid-set
// (`navigation-primitives/01`, pinned by `src/__tests__/focus-modes.test.tsx`).
// A screen that tried to hide the dock itself would be fighting the
// navigator.
//
// **Boundaries** (`screen-composition` §3). There is one section and it is
// the primary content, so it is the one thing allowed a full error
// (`UI-UX.md` §UX4.1 rule 2). The header is not a section: its only
// unconditional content is a way out, and a way out needs no query — which
// is rule 3, and the reason `onExit` is passed straight through rather than
// derived from `state`.
//
// **What goes where.** The header is chrome and owns the way out. The body
// is the primary content: task 03's pager, each page carrying task 04's
// target line, with `set-entry`'s rows to follow beneath it. Task 09's
// program-changed notice and task 07's Finish control sit either side of it
// as siblings rather than children — both are session-scoped, and anything
// inside the body travels with the pages or dies with the pager.
// Session-scoped side effects — task 08's
// `useSessionHeartbeat()`, task 05's `useSessionKeepAwake()` — mount beside
// the read, where they cost no layout and share the body's gate.

export interface SessionLoggerScreenProps {
  /** `local_workout_sessions.client_local_id`, from the route (`useLoggerSession` rule (b)). */
  sessionLocalId: string;
  /**
   * Pauses and leaves. The session stays `in_progress` on the device, so
   * Today offers "Continue" — there is no confirm dialog and nothing to
   * undo (`LoggerHeader`'s `loggerExitAction`).
   */
  onExit: () => void;
  /**
   * The session finished. Called with `local_workout_sessions.client_local_id`
   * — which is the id the summary route is opened with, and is NOT always the
   * `sessionLocalId` this screen was mounted with in principle, so the value
   * `useCompleteSession` hands back is the one that travels.
   *
   * Called only after the local row says `completed` and the server's half is
   * durably queued. A rejected completion never reaches it.
   */
  onCompleted: (sessionLocalId: string) => void;
  /** Freezes the elapsed clock. Injected so it is testable; never passed in the app. */
  now?: Date | undefined;
}

export function SessionLoggerScreen({
  sessionLocalId,
  onExit,
  onCompleted,
  now,
}: SessionLoggerScreenProps) {
  const themed = useThemedStyles();
  // Read from the context rather than through `useSafeAreaInsets()`, which
  // throws where no provider sits above it — the degradation
  // `TodayScreen.tsx` documents for the same reason.
  const insets = useContext(SafeAreaInsetsContext);
  const { state, retry } = useLoggerSession(sessionLocalId);
  // Display only (`CLAUDE.md` §0). Read once here and handed down, rather
  // than by every surface that prints a weight: `me.get` is one query-cache
  // entry, so this costs nothing beyond the call itself.
  const unit = useWeightUnit();

  // Task 03. Built here rather than inside `ExercisePager` so the pager
  // stays controlled: the position has to survive an app kill, so it lives
  // in local SQLite rather than in a component (`useExercisePosition`).
  //
  // `setsLogged` is deliberately unsupplied — nothing in `session-runtime`
  // writes a set log, so every count would be a `0` claiming nothing was
  // logged. `set-entry` owns the counts and their invalidation, and passes
  // them here when it lands (`lib/exercise-pages.ts`).
  //
  // `session-modifications/02`'s substitutions are folded in HERE, at the
  // page model, rather than at each of the four surfaces that would
  // otherwise need to know (`lib/exercise-pages.ts` says why). Subscribed
  // at this level for the reason the PR celebration and the skips give
  // below: the pager keeps three pages alive and swaps them on every turn,
  // and three subscriptions to one session-scoped fact is three chances to
  // disagree about it.
  const substitutions = useSubstitutedExercisesStore(selectSubstitutions);
  const pages = useMemo(
    () =>
      buildExercisePages(
        state.kind === 'session' ? state.session.payload : null,
        undefined,
        substitutions,
      ),
    [state, substitutions],
  );
  const position = useExercisePosition(sessionLocalId, pages.length);

  // The one gate three things read: the claim, the wake lock, and whether
  // there is anything to finish. All three mean "a client is logging right
  // now", and they must never be able to disagree — a session opened for
  // review is not a workout, and each of the three is wrong about it in a
  // different, invisible way.
  const isLogging = state.kind === 'session' && state.session.isInProgress;

  const payload = state.kind === 'session' ? state.session.payload : null;

  // `personal-records/03`. Subscribed HERE rather than in `SetEntrySlot`
  // because the pager keeps three slots alive and swaps them on every page
  // turn — three subscriptions would be three chances to double-fire, and a
  // turn between a send and its delivery could drop the confirmation
  // outright. One per session, for the life of the screen.
  //
  // `isLogging` is the suppression rule: once the session is no longer
  // in progress a late confirmation is DROPPED rather than deferred. The
  // record is still on the client's progress screen; a pill over a finished
  // workout is a notification about the past.
  usePRCelebration({ sessionLocalId, payload, unit, enabled: isLogging });

  // `session-summary/01`'s ledger, and deliberately NOT gated on
  // `isLogging`. The pill is suppressed once the session is finished; the
  // RECORD is not, because the summary lists every one of them and a set
  // logged offline routinely confirms after Finish. Mounted here as well as
  // on the summary route so a confirmation is heard whichever of the two is
  // on top when the flush loop delivers it — recording is idempotent on the
  // set's `client_local_id`, so the overlap costs nothing.
  useSessionRecords({ sessionLocalId });

  // Task 08. Mounted here because the claim belongs to the screen that is
  // open, not to the tap that opened it: `useStartSession` takes the claim,
  // this is what keeps it (DB§14.5 mechanism 3).
  //
  // Both arguments are read off the same state the body renders, and both
  // gate the hook rather than being asserted by it — a session with no
  // server id yet (started offline, outbox unflushed) and one that is not
  // in progress each have nothing to hold, and the hook idles.
  useSessionHeartbeat({
    serverId: state.kind === 'session' ? state.session.serverId : null,
    isActive: isLogging,
  });

  // Task 05. §8.4's "screen stays awake during an active session". Gated on
  // the same `isActive` as the heartbeat rather than on the route: a
  // completed session opened for review is not a workout, and keep-awake is
  // charged against §19's 90-minute battery budget either way.
  useSessionKeepAwake({
    isActive: isLogging,
  });

  // Task 07. The hook holds the rules (the local write is synchronous with
  // the tap, the outbox carries the server's half, a second tap queues
  // nothing); this is only the order the three moves happen in.
  //
  // Nothing is caught here. `SessionFinish` owns the refused-completion
  // surface, and a `catch` at this level would resolve the promise it hands
  // that component — which is a client tapping Finish, seeing nothing, and
  // leaving the session open.
  const { complete } = useCompleteSession();

  // `session-modifications/03`. Subscribed here rather than inside the pager
  // for the reason the PR celebration gives above it: the pager keeps three
  // pages alive and swaps them on every turn, and three subscriptions to one
  // session-scoped fact is three chances to disagree about it.
  const skips = useSkippedExercisesStore(selectSkips);
  const { skip, undo } = useSkipExercise({
    sessionLocalId,
    pageCount: pages.length,
    onAdvance: position.setIndex,
  });

  // Which page the reason sheet is open for, or `null`. The page rather than
  // its key: the sheet names the exercise, and the skip record copies the
  // name the client actually saw.
  const [skipTarget, setSkipTarget] = useState<ExercisePage | null>(null);

  const handleSkipDismiss = useCallback(() => {
    setSkipTarget(null);
  }, []);

  const handleSkipConfirm = useCallback(
    (reason: SkipReason, note: string) => {
      if (skipTarget === null) return;
      // Closed first, so the sheet is already going as the pager moves —
      // the page turn is the confirmation, and it must not wait on a
      // dismissal animation (task 03's "advances immediately").
      setSkipTarget(null);
      skip({ page: skipTarget, reason, note });
    },
    [skip, skipTarget],
  );

  const handleUndoSkip = useCallback(
    (page: ExercisePage) => {
      undo(page.key);
    },
    [undo],
  );

  // `session-modifications/02`. The picker's page, or `null`. The page
  // rather than its key, exactly as the skip sheet holds one: the sheet
  // names the exercise and the substitution record copies the name the
  // client actually saw.
  const { swap, revert } = useSwapExercise({ sessionLocalId });
  const [swapTarget, setSwapTarget] = useState<ExercisePage | null>(null);

  // Resolved from the payload the pager is already rendering from — no
  // fetch, no search, and no path to one (`lib/alternatives.ts`).
  const swapOptions = useMemo(
    () => (swapTarget === null ? [] : resolveAlternatives(swapTarget, payload)),
    [swapTarget, payload],
  );

  const handleSwapDismiss = useCallback(() => {
    setSwapTarget(null);
  }, []);

  const handleSwapSelect = useCallback(
    (substitute: AlternativeExercise) => {
      if (swapTarget === null) return;
      // Closed first, so the page is already showing the substitute as the
      // sheet goes: the picker IS the decision and must not wait on a
      // dismissal animation.
      setSwapTarget(null);
      swap({ page: swapTarget, substitute });
    },
    [swap, swapTarget],
  );

  const handleSwapRevert = useCallback(() => {
    if (swapTarget === null) return;
    setSwapTarget(null);
    revert(swapTarget.key);
  }, [revert, swapTarget]);

  // The empty state's one next step. A client with no approved swap and no
  // working equipment still has task 03's skip, whose first reason is
  // "Equipment unavailable" — so the two sheets hand off rather than leaving
  // the client on a dead end (`SwapExerciseSheet` decision (b)).
  const handleSwapEmptySkip = useCallback(() => {
    const page = swapTarget;
    if (page === null) return;
    setSwapTarget(null);
    setSkipTarget(page);
  }, [swapTarget]);

  const handleFinish = useCallback(async () => {
    const { localId } = await complete(sessionLocalId);
    // `ui-conventions` §5's one sanctioned `Success`, and the only place in
    // the product it may fire. After the write, never awaited, and never on
    // the path that rejected — a refused completion fires nothing, because
    // `Warning` belongs to validation failure and a mirror that could not be
    // written is not the client mistyping something.
    hapticSessionComplete();
    onCompleted(localId);
  }, [complete, onCompleted, sessionLocalId]);

  return (
    <View
      style={[
        styles.screen,
        themed.screen,
        { paddingTop: insets?.top ?? 0, paddingBottom: insets?.bottom ?? 0 },
      ]}
    >
      <LoggerHeader state={state} onExit={onExit} now={now} />
      {/* Task 09. Outside the body because the body is the pager's box — a
          note inside it would travel with the pages. Self-gating: it renders
          only while the frozen and live prescriptions disagree, and carries
          its own gutter. */}
      <ProgramChangedNotice payload={state.kind === 'session' ? state.session.payload : null} />
      {/* `rest-timer/05`. ABOVE the body, never between it and the footer —
          everything below the body is bottom-pinned down to `set-entry`'s
          composer, so a bar seated under the body would lift its confirm
          control off the one screen coordinate it holds for the whole
          session. Above it, the body's top edge moves and `SetList` gives
          way, which is what that list is for. Self-gating and carrying its
          own gutter, the same shape as the notice above it. It subscribes
          to the rest store itself and takes nothing from it through here,
          so this screen never re-renders on the tick. */}
      <RestTimerBar now={now} />
      {/* Always mounted, always this shape: the body reserves its box in
          every state, so nothing shifts when the read lands
          (`screen-composition` §4). */}
      <View style={styles.body} testID="logger-body">
        {renderBody(state, {
          onExit,
          onRetry: retry,
          pages,
          currentIndex: position.index,
          onIndexChange: position.setIndex,
          payload,
          sessionLocalId,
          celebratesRecords: isLogging,
          skips,
          // Gated on the same `isLogging` as the heartbeat and the wake
          // lock: a finished session opened for review is not a workout, and
          // offering to skip an exercise in one would write a fact about a
          // session that is over. The skipped STATES still render — that is
          // what the review is for.
          onSkipPress: isLogging ? setSkipTarget : undefined,
          onUndoSkip: isLogging ? handleUndoSkip : undefined,
          // Gated on the same `isLogging`, for the same reason: swapping an
          // exercise in a session that is over would change what a finished
          // workout claims the client did. A substitution already made still
          // RENDERS — that is what the review is for.
          onSwapPress: isLogging ? setSwapTarget : undefined,
        })}
      </View>
      {/* Outside the body: a sheet is not part of the pager's box, and the
          page it was opened from is gone by the time it closes. Always
          mounted so its open/close is a prop rather than a remount. */}
      <SkipExerciseSheet
        isOpen={skipTarget !== null}
        exerciseName={skipTarget?.name ?? ''}
        onDismiss={handleSkipDismiss}
        onConfirm={handleSkipConfirm}
      />
      {/* Task 02's picker, mounted beside task 03's for the same reasons:
          a sheet is not part of the pager's box, and the page it was opened
          from is gone by the time it closes. */}
      <SwapExerciseSheet
        isOpen={swapTarget !== null}
        exerciseName={swapTarget?.substitutedFor?.name ?? swapTarget?.name ?? ''}
        alternatives={swapOptions}
        currentSubstituteId={swapTarget?.substitutedFor ? swapTarget.exerciseId : null}
        revertToName={swapTarget?.substitutedFor?.name ?? null}
        onDismiss={handleSwapDismiss}
        onSelect={handleSwapSelect}
        onRevert={handleSwapRevert}
        onSkipInstead={handleSwapEmptySkip}
      />
      {/* Task 07, and a sibling of the body rather than part of it: the
          control ends the SESSION, so it must outlive the pager. An ad-hoc
          session renders `LoggerNoPrescription` above and still needs a way
          to finish — it is the case that needs one most, since there is no
          last exercise to arrive at. It is also `screen-composition` §3
          rule 3's action bar, which depends on no query beyond this gate. */}
      {isLogging ? (
        <View style={styles.footer}>
          <SessionFinish onFinish={handleFinish} />
        </View>
      ) : null}
    </View>
  );
}

interface BodyHandlers {
  onExit: () => void;
  onRetry: () => void;
  /** Task 03's page model. Empty for a session with no prescription to page. */
  pages: readonly ExercisePage[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  /** Task 04's live prescription mirror. `null` whenever there is no session to read. */
  payload: LocalSessionPayload | null;
  sessionLocalId: string;
  /**
   * `personal-records/03`. True while the session is still in progress; the
   * CURRENT page is the one that actually draws the pill, so this is ANDed
   * with `isCurrent` below. Both halves are needed: a finished session shows
   * no pill at all, and an off-screen page must not draw a second one.
   */
  celebratesRecords: boolean;
  /** `session-modifications/03` — what the client skipped, by `ExercisePage.key`. */
  skips: ReadonlyMap<string, SkippedExercise>;
  /** Opens the reason sheet. `undefined` once the session is no longer in progress. */
  onSkipPress: ((page: ExercisePage) => void) | undefined;
  onUndoSkip: ((page: ExercisePage) => void) | undefined;
  /** `session-modifications/02` — opens the swap picker. Same gate as the skip. */
  onSwapPress: ((page: ExercisePage) => void) | undefined;
}

function renderBody(state: LoggerSessionState, handlers: BodyHandlers) {
  switch (state.kind) {
    case 'loading':
      // Deliberately nothing. The read is one indexed SELECT on an open
      // handle, so it resolves inside a frame — a skeleton here would be a
      // flicker, and `DESIGN.md` §5 forbids a spinner outright.
      return null;

    case 'error':
      return (
        <View style={styles.centred}>
          <LoggerLoadError onRetry={handlers.onRetry} />
        </View>
      );

    case 'not-found':
      // An id the device does not hold: a stale deep link, or a cache
      // cleared between the link and the tap. `CLAUDE.md` §9.2 requires an
      // id-route's not-found state to be recoverable rather than a dead
      // end, and `NotFoundState`'s `onRecover` is required for that reason.
      // Never `ForbiddenState` — a client can only ever open their own
      // sessions, so there is no "not yours" case to confuse this with
      // (`ERRORS.md` ER§2.1).
      return (
        <View style={styles.centred}>
          <NotFoundState onRecover={handlers.onExit} density="client" />
        </View>
      );

    case 'session':
      // `pages`, not `exerciseCount`: they are derived from the same
      // payload and agree, but the pager is what renders, so the emptiness
      // that decides between these two branches must be the pager's.
      return handlers.pages.length === 0 ? (
        <View style={styles.centred}>
          <LoggerNoPrescription />
        </View>
      ) : (
        // Task 03's pager, filled with task 04's target line. `renderPage`
        // runs for the current page and its two neighbours only, which is
        // what keeps the history read off the pages a client cannot see.
        // `set-entry`'s set rows and stepper mount under this, inside the
        // same slot.
        <ExercisePager
          pages={handlers.pages}
          currentIndex={handlers.currentIndex}
          onIndexChange={handlers.onIndexChange}
          skips={handlers.skips}
          onSkipPress={handlers.onSkipPress}
          onUndoSkip={handlers.onUndoSkip}
          onSwapPress={handlers.onSwapPress}
          renderPage={(page, isCurrent) => (
            // The page's own composition: task 04's target line at its
            // natural height, then `set-entry`'s slot taking the rest.
            // `flex: 1` here is what makes the composer bottom-pinned — the
            // slot measures itself against what the target line leaves.
            <View style={styles.page}>
              <TargetLine
                page={page}
                payload={handlers.payload}
                sessionLocalId={handlers.sessionLocalId}
              />
              <SetEntrySlot
                page={page}
                payload={handlers.payload}
                sessionLocalId={handlers.sessionLocalId}
                celebratesRecords={isCurrent && handlers.celebratesRecords}
              />
            </View>
          )}
        />
      );
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  body: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: density.client.gutter,
  },
  centred: {
    flex: 1,
    justifyContent: 'center',
  },
  page: {
    flex: 1,
    minHeight: 0,
    // The page's own rhythm, matching `ExercisePager`'s gap between the
    // head block and this content.
    gap: spacing(12),
  },
  footer: {
    // The body's gutter, so the control lines up with the page above it.
    // The vertical rhythm is `SessionFinish`'s own, and the root's
    // `paddingBottom: insets.bottom` keeps it clear of the home indicator.
    paddingHorizontal: density.client.gutter,
  },
});

const useThemedStyles = createThemedStyles(({ colors }) => ({
  screen: {
    backgroundColor: colors.bg.DEFAULT,
  },
}));
