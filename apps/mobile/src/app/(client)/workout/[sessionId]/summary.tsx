import { useLocalSearchParams, useRouter } from 'expo-router';

import { SessionSummaryScreen } from '../../../../features/workouts/components/SessionSummaryScreen.tsx';

// Composition only (`code-conventions` §1) — the screen owns its read, its
// states and its copy; this file owns the param and where the way out goes.
//
// `sessionId` is `local_workout_sessions.client_local_id`, the id
// `useCompleteSession` hands back and `workout/[sessionId].tsx` `replace`s
// with. Deliberately not parsed against a uuid, for the reason the logger
// route gives: a materialised session's key is deterministic rather than
// random (DB§14.5), and an id the device does not hold already resolves to
// the screen's own missing state — which is the honest answer for a
// malformed one too.
//
// Registered in `(client)/_layout.tsx` as an ordinary push, NOT a focus
// mode: the summary is read after the work, so it keeps the back gesture
// and needs no single forced exit.
export default function ClientWorkoutSummaryScreen() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();

  return (
    <SessionSummaryScreen
      sessionLocalId={sessionId ?? ''}
      onDone={() => {
        // `replace`, and to Today rather than `back()`. The logger replaced
        // itself with this route, so on the ordinary path there is nothing
        // behind it — and a deep link can land here with nothing behind it
        // at all (`features/navigation/deep-links/link-table.ts`). Today is
        // where a finished session belongs afterwards, so it is where Done
        // goes in both cases.
        router.replace('/(client)/(tabs)');
      }}
    />
  );
}
