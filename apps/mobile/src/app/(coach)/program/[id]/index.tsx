import { useLocalSearchParams, useRouter } from 'expo-router';

import { ProgramBuilderScreen } from '../../../../features/programs/screens/ProgramBuilderScreen.tsx';

// Composition only (`CLAUDE.md` §9.2) — the screen owns its own query and
// its four states; this file owns where a tap goes.
export default function CoachProgramScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ProgramBuilderScreen
      programId={id}
      onBack={() => {
        router.back();
      }}
      onOpenDay={(dayId) => {
        router.push({ pathname: '/(coach)/program/[id]/day/[dayId]', params: { id, dayId } });
      }}
      onInviteClient={() => {
        router.push('/(coach)/invite-client');
      }}
    />
  );
}
