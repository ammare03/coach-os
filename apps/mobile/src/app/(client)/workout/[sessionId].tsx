import { useLocalSearchParams, useRouter } from 'expo-router';

import { SessionLoggerScreen } from '../../../features/workouts/components/SessionLoggerScreen.tsx';

// Composition only (`CLAUDE.md` §9.2, `code-conventions` §1) — the screen
// owns its read, its four states and its copy; this file owns the param and
// where the way out goes.
//
// `sessionId` is `local_workout_sessions.client_local_id`, which is what
// `(tabs)/index.tsx` pushes for both an assigned session and an ad-hoc one
// (`useLoggerSession` rule (b)). It is deliberately not parsed against a
// uuid: a materialised session's key is deterministic rather than random
// (DB§14.5), and an id the device does not hold already resolves to the
// screen's own recoverable not-found state — which is the honest answer for
// a malformed one too.
export default function ClientWorkoutScreen() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();

  return (
    <SessionLoggerScreen
      sessionLocalId={sessionId ?? ''}
      onExit={() => {
        // A deep link can land here with nothing behind it
        // (`features/navigation/deep-links/link-table.ts`), and `back()` on
        // an empty history leaves the client stranded in a focus mode with
        // no dock. Today is where a paused session is resumed from, so it
        // is also the right place to be returned to.
        if (router.canGoBack()) {
          router.back();
          return;
        }
        router.replace('/(client)/(tabs)');
      }}
    />
  );
}
