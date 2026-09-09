import {
  EmptyState,
  Input,
  LoadingState,
  Pressable,
  Sheet,
  SheetFooter,
  SheetHeader,
  spacing,
  Text,
  createThemedStyles,
  radius,
  useTheme,
} from '@coachos/ui';
import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { api } from '../../../lib/trpc.ts';
import type { AddedExercise } from '../hooks/useProgramDraft.ts';

// `phase-06-onboarding/coach-onboarding/03` — picking exercises for one day
// of the onboarding program.
//
// A sheet, not a route: it opens on top of the step the coach is already
// filling in and has nothing to deep-link to (`ui-conventions` §5). Sets
// and reps are NOT asked for here — they are set on the day card afterwards
// (`useProgramDraft`'s defaults), because asking per exercise mid-search is
// what turns a twenty-second task into a two-minute one.
//
// Multi-select, and the footer counts the selection ("Add 2 exercises"),
// which `SheetFooter` requires and `DESIGN.md` §10.8 states as law.

export interface ExercisePickerSheetProps {
  isOpen: boolean;
  /** Named in the header so a coach picking for Day 3 can see that they are. */
  dayName: string;
  /** Already on the day — shown ticked and inert, never offered twice. */
  alreadyAdded: readonly string[];
  onAdd: (exercises: readonly AddedExercise[]) => void;
  onDismiss: () => void;
}

const CHECKBOX = 24;

export function ExercisePickerSheet({
  isOpen,
  dayName,
  alreadyAdded,
  onAdd,
  onDismiss,
}: ExercisePickerSheetProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<readonly AddedExercise[]>([]);

  // A fresh sheet every time it opens — a selection carried over from the
  // last day would silently add exercises to a day the coach never picked
  // them for.
  //
  // Adjusted during render against the previous `isOpen` rather than in an
  // effect: React's own documented pattern for "reset state when a prop
  // changes", and the one the `react-hooks` rule here requires — an effect
  // calling `setState` synchronously renders the stale selection for a
  // frame first.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setQuery('');
      setSelected([]);
    }
  }

  function toggle(exercise: AddedExercise) {
    setSelected((current) =>
      current.some((item) => item.exerciseId === exercise.exerciseId)
        ? current.filter((item) => item.exerciseId !== exercise.exerciseId)
        : [...current, exercise],
    );
  }

  return (
    <Sheet isOpen={isOpen} onDismiss={onDismiss} snap="full" testID="exercise-picker">
      <SheetHeader title={`Add to ${dayName}`} onClose={onDismiss} />

      <View style={styles.search}>
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Search exercises"
          accessibilityLabel="Search exercises"
          returnKeyType="search"
        />
      </View>

      {/* Mounted only while the sheet is open. `enabled: false` would stop
          the request but not the subscription, and a picker that is not on
          screen has no business holding a query at all. */}
      {isOpen ? (
        <ExerciseResults
          query={query.trim()}
          alreadyAdded={alreadyAdded}
          selected={selected}
          onToggle={toggle}
          onClearSearch={() => setQuery('')}
        />
      ) : null}

      <SheetFooter
        actionLabel={selected.length === 1 ? 'Add 1 exercise' : `Add ${selected.length} exercises`}
        isActionDisabled={selected.length === 0}
        onAction={() => {
          onAdd(selected);
          onDismiss();
        }}
      />
    </Sheet>
  );
}

interface ExerciseResultsProps {
  query: string;
  alreadyAdded: readonly string[];
  selected: readonly AddedExercise[];
  onToggle: (exercise: AddedExercise) => void;
  onClearSearch: () => void;
}

function ExerciseResults({
  query,
  alreadyAdded,
  selected,
  onToggle,
  onClearSearch,
}: ExerciseResultsProps) {
  const theme = useTheme();
  const themed = useThemedStyles();
  const results = api.exercises.search.useQuery({ query });

  return (
    <ScrollView
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {results.isPending ? (
        <LoadingState shape="list" accessibilityLabel="Loading exercises" />
      ) : results.isError ? (
        <EmptyState
          title="We couldn’t load the library"
          body="Check your connection and try again."
          primaryAction={{ label: 'Try again', onPress: () => void results.refetch() }}
        />
      ) : results.data.length === 0 ? (
        <EmptyState
          title="Nothing matches that"
          body="Try a shorter word — “squat” rather than “barbell back squat”."
          primaryAction={{ label: 'Clear search', onPress: onClearSearch }}
        />
      ) : (
        results.data.map((exercise) => {
          const isAdded = alreadyAdded.includes(exercise.id);
          const isSelected = isAdded || selected.some((item) => item.exerciseId === exercise.id);
          return (
            <Pressable
              key={exercise.id}
              onPress={
                isAdded
                  ? undefined
                  : () => onToggle({ exerciseId: exercise.id, name: exercise.name })
              }
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected, disabled: isAdded }}
              accessibilityLabel={exercise.name}
              accessibilityHint={isAdded ? 'Already on this day' : undefined}
              style={[styles.row, themed.row]}
            >
              <View
                style={[styles.box, isSelected ? themed.boxOn : themed.boxOff]}
                pointerEvents="none"
              >
                {isSelected ? <Check size={14} color={theme.colors.fg.onBrand} /> : null}
              </View>
              <View style={styles.rowText}>
                <Text size="label">{exercise.name}</Text>
                <Text size="caption" tone="subtle">
                  {exercise.primaryMuscle} · {exercise.equipment}
                  {isAdded ? ' · already added' : ''}
                </Text>
              </View>
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  search: { paddingHorizontal: spacing(18), paddingTop: spacing(14) },
  list: { paddingHorizontal: spacing(18), paddingTop: spacing(6), paddingBottom: spacing(12) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(12),
    paddingVertical: spacing(13),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  box: {
    width: CHECKBOX,
    height: CHECKBOX,
    borderRadius: radius.control,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
});

const useThemedStyles = createThemedStyles((theme) => ({
  row: { borderBottomColor: theme.colors.border.soft },
  boxOn: { backgroundColor: theme.colors.primary.from, borderColor: theme.colors.primary.from },
  boxOff: { backgroundColor: theme.control.surface, borderColor: theme.colors.border.strong },
}));
