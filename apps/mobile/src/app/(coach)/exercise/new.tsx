import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { ExerciseForm } from '../../../features/workouts/components/library/ExerciseForm.tsx';
import { useExerciseMutations } from '../../../features/workouts/hooks/useExerciseMutations.ts';

// The create entry point (`exercise-library/03`, Interfaces). A route rather
// than a sheet, because it accepts an optional prefilled name: the picker's
// "create '<query>'" row and the library's own empty state both land here
// with the name already typed.
export default function NewExerciseScreen() {
  const router = useRouter();
  const { name } = useLocalSearchParams<{ name?: string }>();
  const { create } = useExerciseMutations();
  const [nameError, setNameError] = useState<string | undefined>(undefined);

  return (
    <ExerciseForm
      mode="create"
      initialValues={name ? { name } : undefined}
      isSubmitting={create.isPending}
      nameError={nameError}
      onCancel={() => {
        router.back();
      }}
      onOpenExisting={(exerciseId) => {
        router.replace({ pathname: '/(coach)/exercise/[exerciseId]', params: { exerciseId } });
      }}
      onSubmit={(values) => {
        setNameError(undefined);
        create.mutate(values, {
          onSuccess: () => {
            router.back();
          },
          onError: (error) => {
            // `EXERCISE_NAME_TAKEN` belongs on the name field, not in a
            // toast — it is a correction the coach makes in place, and a
            // toast makes them re-find the field it refers to.
            if (error.data?.appCode === 'EXERCISE_NAME_TAKEN') {
              setNameError('You already have an exercise called this.');
            }
          },
        });
      }}
    />
  );
}
