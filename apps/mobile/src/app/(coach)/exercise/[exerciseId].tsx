import { ForbiddenState, LoadingState, NotFoundState } from '@coachos/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { useExercise } from '../../../features/workouts/api/exercises.ts';
import { ExerciseForm } from '../../../features/workouts/components/library/ExerciseForm.tsx';
import { useExerciseMutations } from '../../../features/workouts/hooks/useExerciseMutations.ts';

// The edit route. A GLOBAL exercise reaches it — the library links every row
// here — and gets `ForbiddenState` rather than an editable form: the row is
// not hidden from the coach, so there is no enumeration oracle to close, and
// "you can't edit this, make your own" is both true and more useful than a
// row that silently refuses to open.
export default function EditExerciseScreen() {
  const router = useRouter();
  const { exerciseId } = useLocalSearchParams<{ exerciseId: string }>();
  const { update, archiveWithUndo } = useExerciseMutations();
  const [nameError, setNameError] = useState<string | undefined>(undefined);

  const exercise = useExercise(exerciseId);

  if (exercise.isPending) {
    return <LoadingState shape="detail" accessibilityLabel="Loading this exercise" />;
  }

  // `ERRORS.md` ER§2.1: another coach's exercise comes back as NOT_FOUND,
  // never FORBIDDEN, so it renders here and not in the branch below.
  if (exercise.isError) {
    return (
      <NotFoundState
        onRecover={() => {
          router.back();
        }}
      />
    );
  }

  if (!exercise.data.isCustom) {
    return (
      <ForbiddenState
        title="Global exercises can't be edited"
        body="Every coach's programs point at this one. Create your own version instead — it sits above the global library in search."
        onRecover={() => {
          router.replace({
            pathname: '/(coach)/exercise/new',
            params: { name: exercise.data.name },
          });
        }}
        recoverLabel="Create my own version"
      />
    );
  }

  const current = exercise.data;

  return (
    <ExerciseForm
      mode="edit"
      editingExerciseId={current.id}
      initialValues={{
        name: current.name,
        primaryMuscle: current.primaryMuscle,
        equipment: current.equipment,
        movementPattern: current.movementPattern,
        cues: [...current.cues],
        defaultIncrementKg: current.defaultIncrementKg,
        isUnilateral: current.isUnilateral,
        isBodyweight: current.isBodyweight,
      }}
      isSubmitting={update.isPending}
      nameError={nameError}
      onCancel={() => {
        router.back();
      }}
      onArchive={() => {
        // Leaves immediately, and the mutation is deferred until the undo
        // window closes (`useUndoToast`) — so there is nothing to put back
        // locally, and `onUndo` only has to keep the coach where they are.
        router.back();
        archiveWithUndo({ id: current.id, name: current.name }, () => undefined);
      }}
      onSubmit={(values) => {
        setNameError(undefined);
        update.mutate(
          { exerciseId: current.id, ...values },
          {
            onSuccess: () => {
              router.back();
            },
            onError: (error) => {
              if (error.data?.appCode === 'EXERCISE_NAME_TAKEN') {
                setNameError('You already have an exercise called this.');
              }
            },
          },
        );
      }}
    />
  );
}
