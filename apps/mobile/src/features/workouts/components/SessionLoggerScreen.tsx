import { NotFoundState } from '@coachos/ui';
import { createThemedStyles, density } from '@coachos/ui/theme';
import { useContext } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { useLoggerSession, type LoggerSessionState } from '../hooks/useLoggerSession.ts';

import { LoggerHeader } from './LoggerHeader.tsx';
import { LoggerLoadError } from './LoggerLoadError.tsx';
import { LoggerNoPrescription } from './LoggerNoPrescription.tsx';

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
// **Where the next tasks attach.** The body slot below is task 03's
// (exercise paging) and task 04's (the target line). Task 05 mounts
// `useKeepAwake()` and task 08 a `useSessionHeartbeat()` in this component —
// both are session-scoped side effects that belong beside the read, and
// neither changes the layout.

export interface SessionLoggerScreenProps {
  /** `local_workout_sessions.client_local_id`, from the route (`useLoggerSession` rule (b)). */
  sessionLocalId: string;
  /**
   * Pauses and leaves. The session stays `in_progress` on the device, so
   * Today offers "Continue" — there is no confirm dialog and nothing to
   * undo (`LoggerHeader`'s `loggerExitAction`).
   */
  onExit: () => void;
  /** Freezes the elapsed clock. Injected so it is testable; never passed in the app. */
  now?: Date | undefined;
}

export function SessionLoggerScreen({ sessionLocalId, onExit, now }: SessionLoggerScreenProps) {
  const themed = useThemedStyles();
  // Read from the context rather than through `useSafeAreaInsets()`, which
  // throws where no provider sits above it — the degradation
  // `TodayScreen.tsx` documents for the same reason.
  const insets = useContext(SafeAreaInsetsContext);
  const { state, retry } = useLoggerSession(sessionLocalId);

  return (
    <View
      style={[
        styles.screen,
        themed.screen,
        { paddingTop: insets?.top ?? 0, paddingBottom: insets?.bottom ?? 0 },
      ]}
    >
      <LoggerHeader state={state} onExit={onExit} now={now} />
      {/* Always mounted, always this shape: the body reserves its box in
          every state, so nothing shifts when the read lands
          (`screen-composition` §4). */}
      <View style={styles.body} testID="logger-body">
        {renderBody(state, { onExit, onRetry: retry })}
      </View>
    </View>
  );
}

interface BodyHandlers {
  onExit: () => void;
  onRetry: () => void;
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
      return state.session.exerciseCount === 0 ? (
        <View style={styles.centred}>
          <LoggerNoPrescription />
        </View>
      ) : // Task 03's slot: one exercise at a time, with task 04's target
      // line above it. Empty until then, deliberately — a placeholder
      // rendered here would be the design by default, which is the one
      // thing `design-gate` exists to prevent.
      null;
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
});

const useThemedStyles = createThemedStyles(({ colors }) => ({
  screen: {
    backgroundColor: colors.bg.DEFAULT,
  },
}));
