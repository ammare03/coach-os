import { useRouter } from 'expo-router';

import { ExerciseLibraryScreen } from '../../features/workouts/components/library/ExerciseLibraryScreen.tsx';

// Composition only (`CLAUDE.md` §9.2) — the screen owns its own queries and
// states; this file owns where a tap goes.
export default function CoachExerciseLibraryScreen() {
  const router = useRouter();

  return (
    <ExerciseLibraryScreen
      onCreate={(prefilledName) => {
        router.push({
          pathname: '/(coach)/exercise/new',
          params: prefilledName ? { name: prefilledName } : {},
        });
      }}
      onOpen={(exerciseId) => {
        // Global exercises route here too. The screen is read-only for them
        // and says why — a row that simply does not respond to a tap reads
        // as broken rather than as deliberate.
        router.push({ pathname: '/(coach)/exercise/[exerciseId]', params: { exerciseId } });
      }}
    />
  );
}
