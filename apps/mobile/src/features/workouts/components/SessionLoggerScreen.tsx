import { NotFoundState, hapticSessionComplete } from '@coachos/ui';
import { createThemedStyles, density } from '@coachos/ui/theme';
import { useCallback, useContext, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import type { LocalSessionPayload } from '../../../lib/prefetch/sessions.ts';
import { useCompleteSession } from '../hooks/useCompleteSession.ts';
import { useExercisePosition } from '../hooks/useExercisePosition.ts';
import { useLoggerSession, type LoggerSessionState } from '../hooks/useLoggerSession.ts';
import { useSessionHeartbeat } from '../hooks/useSessionHeartbeat.ts';
import { useSessionKeepAwake } from '../hooks/useSessionKeepAwake.ts';
import { buildExercisePages, type ExercisePage } from '../lib/exercise-pages.ts';

import { ExercisePager } from './ExercisePager.tsx';
import { LoggerHeader } from './LoggerHeader.tsx';
import { LoggerLoadError } from './LoggerLoadError.tsx';
import { LoggerNoPrescription } from './LoggerNoPrescription.tsx';
import { ProgramChangedNotice } from './ProgramChangedNotice.tsx';
import { SessionFinish } from './SessionFinish.tsx';
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

  // Task 03. Built here rather than inside `ExercisePager` so the pager
  // stays controlled: the position has to survive an app kill, so it lives
  // in local SQLite rather than in a component (`useExercisePosition`).
  //
  // `setsLogged` is deliberately unsupplied — nothing in `session-runtime`
  // writes a set log, so every count would be a `0` claiming nothing was
  // logged. `set-entry` owns the counts and their invalidation, and passes
  // them here when it lands (`lib/exercise-pages.ts`).
  const pages = useMemo(
    () => buildExercisePages(state.kind === 'session' ? state.session.payload : null),
    [state],
  );
  const position = useExercisePosition(sessionLocalId, pages.length);

  // The one gate three things read: the claim, the wake lock, and whether
  // there is anything to finish. All three mean "a client is logging right
  // now", and they must never be able to disagree — a session opened for
  // review is not a workout, and each of the three is wrong about it in a
  // different, invisible way.
  const isLogging = state.kind === 'session' && state.session.isInProgress;

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
          payload: state.kind === 'session' ? state.session.payload : null,
          sessionLocalId,
        })}
      </View>
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
          renderPage={(page) => (
            <TargetLine
              page={page}
              payload={handlers.payload}
              sessionLocalId={handlers.sessionLocalId}
            />
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
