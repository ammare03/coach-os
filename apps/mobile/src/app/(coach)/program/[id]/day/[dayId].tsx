import { useLocalSearchParams, useRouter } from 'expo-router';

import { ProgramDayScreen } from '../../../../../features/programs/screens/ProgramDayScreen.tsx';

// Composition only (`CLAUDE.md` §9.2) — the screen owns its own query and
// its four states; this file owns where a tap goes.
export default function CoachProgramDayScreen() {
  const router = useRouter();
  const { id, dayId } = useLocalSearchParams<{ id: string; dayId: string }>();

  return (
    <ProgramDayScreen
      programDayId={dayId}
      onBack={() => {
        router.back();
      }}
      // A sibling slot REPLACES this screen rather than stacking on it: the
      // day strip is lateral movement inside one week, and pushing would
      // build a back stack of days a coach then has to unwind one tap at a
      // time to reach the builder.
      onOpenDay={(nextDayId) => {
        router.replace({
          pathname: '/(coach)/program/[id]/day/[dayId]',
          params: { id, dayId: nextDayId },
        });
      }}
    />
  );
}
