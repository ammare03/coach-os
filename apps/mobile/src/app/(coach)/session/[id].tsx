import { useLocalSearchParams, useRouter } from 'expo-router';

import { SessionReviewScreen } from '../../../features/clients/screens/SessionReviewScreen.tsx';

// Composition only (`CLAUDE.md` §9.2, `code-conventions` §1) — the screen
// owns its read, its four states and its copy; this file owns the param and
// where the one way out goes
// (`phase-10-coach-review-surfaces/session-review/01`).
//
// `_layout.tsx` registers this route `presentation: 'fullScreenModal'` with
// `gestureEnabled: false`, so the screen's own **Close** is the only exit
// and there is no edge swipe to fall back on. That is also why the way out
// below has a second branch: a coach arriving from a push notification has
// nothing behind them to dismiss to.
//
// `id` is a `workout_sessions.id`. Deliberately not parsed against a uuid
// here: an id that is not this coach's client's returns `NOT_YOUR_CLIENT`
// and the screen renders its recoverable not-found state — which is the
// honest answer for a malformed id too, and `ERRORS.md` ER§2.1's reason for
// not distinguishing the two at all.
export default function CoachSessionReviewScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <SessionReviewScreen
      sessionId={id ?? ''}
      onClose={() => {
        // A modal DISMISSES rather than pops, and `dismiss()` on an empty
        // modal stack does nothing at all — which in a focus mode with no
        // dock and no gesture would be a trap. The roster is where a coach's
        // review block runs from, so it is where an unstacked arrival is
        // returned to.
        if (router.canGoBack()) {
          router.back();
          return;
        }
        router.replace('/(coach)/(tabs)');
      }}
    />
  );
}
