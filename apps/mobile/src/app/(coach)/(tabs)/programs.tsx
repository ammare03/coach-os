import { useRouter } from 'expo-router';

import { ProgramTemplatesScreen } from '../../../features/programs/screens/ProgramTemplatesScreen.tsx';

// Composition only (`CLAUDE.md` §9.2) — the screen owns its query and
// states; this file owns where a tap goes (`program-templates/01`).
export default function CoachProgramsScreen() {
  const router = useRouter();

  return (
    <ProgramTemplatesScreen
      onOpenProgram={(programId) => {
        router.push({ pathname: '/(coach)/program/[id]', params: { id: programId } });
      }}
    />
  );
}
