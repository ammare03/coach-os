import { exercises as exercisesSchemas } from '@coachos/schemas';
import {
  Badge,
  Button,
  Card,
  Chip,
  createThemedStyles,
  density,
  EmptyState,
  Input,
  LoadingState,
  Pressable,
  radius,
  spacing,
  Text,
  useTheme,
} from '@coachos/ui';
import { ChevronRight, Dumbbell, Plus, TriangleAlert } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useExerciseLibrary, useExerciseSearch } from '../../api/exercises.ts';

// `(coach)/exercise-library` — a Scan list (`UI-UX.md` §UX2), coach density.
//
// **Split into "Your exercises" then "Global library", not one alphabetical
// run.** The coach's own vocabulary is what they came here for, and it is
// also the only part of the library they can edit — a single run buries
// seven custom rows inside a hundred and twenty seeded ones and gives the
// edit affordance nothing to attach to.
//
// Archived exercises are absent by construction: `exercises.list` and
// `exercises.search` both exclude them (`exercise-library/01`, Approach
// step 2). There is no "show archived" toggle here, and adding one is a
// design decision rather than a convenience.

export interface ExerciseLibraryScreenProps {
  onCreate: (prefilledName?: string) => void;
  onOpen: (exerciseId: string, isCustom: boolean) => void;
}

/**
 * Inferred from the query, never declared. `exercises.list` already knows
 * this shape and it is derived from `training.exercises` at the other end —
 * a hand-written mirror here would be a second source of truth that drifts
 * (`code-conventions` §3).
 */
type LibraryExercise = NonNullable<
  ReturnType<typeof useExerciseLibrary>['data']
>['pages'][number]['items'][number];

const GUTTER = density.coach.gutter;

/** Below this the search is not worth a round trip and `list` still holds the answer. */
const MIN_SEARCH_LENGTH = 2;

const PATTERN_FILTERS = exercisesSchemas.movementPatternValue.options;

const PATTERN_LABEL: Record<(typeof PATTERN_FILTERS)[number], string> = {
  squat: 'Squat',
  hinge: 'Hinge',
  push: 'Push',
  pull: 'Pull',
  carry: 'Carry',
  core: 'Core',
  isolation: 'Isolation',
  other: 'Other',
};

export function ExerciseLibraryScreen({ onCreate, onOpen }: ExerciseLibraryScreenProps) {
  const theme = useTheme();
  const themed = useThemedStyles();
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState('');
  const [pattern, setPattern] = useState<(typeof PATTERN_FILTERS)[number] | null>(null);

  const trimmedQuery = query.trim();
  const isSearching = trimmedQuery.length >= MIN_SEARCH_LENGTH;

  const library = useExerciseLibrary(pattern ? { movementPattern: pattern } : {});
  const search = useExerciseSearch(trimmedQuery, isSearching);

  // Exactly one of the two queries is in charge at a time. Merging them
  // would mean rendering a stale list under a fresh query for a frame,
  // which reads as the search having missed something.
  const active = isSearching ? search : library;

  const rows = useMemo<{ mine: LibraryExercise[]; global: LibraryExercise[] }>(() => {
    const items = isSearching
      ? (search.data ?? [])
      : (library.data?.pages.flatMap((page) => page.items) ?? []);
    return {
      mine: items.filter((item) => item.isCustom),
      global: items.filter((item) => !item.isCustom),
    };
  }, [isSearching, search.data, library.data]);

  const total = rows.mine.length + rows.global.length;

  return (
    <View style={[styles.flex, themed.screen]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + spacing(6), paddingBottom: insets.bottom + spacing(52) },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text size="h1">Exercise library</Text>
        <Text size="caption" tone="muted" style={styles.subtitle}>
          Your own exercises come first. Global ones are shared with every coach.
        </Text>

        <View style={styles.search}>
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="Search exercises"
            accessibilityLabel="Search exercises"
            returnKeyType="search"
            autoCorrect={false}
            density="coach"
            testID="exercise-search"
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          <Chip
            label="All"
            selected={pattern === null}
            onPress={() => {
              setPattern(null);
            }}
            testID="filter-all"
          />
          {PATTERN_FILTERS.map((value) => (
            <Chip
              key={value}
              label={PATTERN_LABEL[value]}
              selected={pattern === value}
              onPress={() => {
                setPattern(pattern === value ? null : value);
              }}
              testID={`filter-${value}`}
            />
          ))}
        </ScrollView>

        {active.isPending ? (
          <LoadingState shape="list" rows={6} accessibilityLabel="Loading the exercise library" />
        ) : active.isError ? (
          <EmptyState
            // `brand.mid`, not a red. `DESIGN.md` §8 reserves both the
            // `state.*` ramp and `urgent-text` for adherence (enforced by
            // the `adherence-colors-only` lint rule), and a failed fetch is
            // not an adherence signal — the copy carries the meaning here,
            // the glyph only draws the eye.
            icon={<TriangleAlert size={22} color={theme.colors.brand.mid} />}
            title="We couldn't load the library"
            // Says what still works, per `COPY.md` — an error that only
            // announces failure leaves the coach guessing what it cost them.
            body="Check your connection and try again. Programs you have already built are unaffected."
            primaryAction={{
              label: 'Try again',
              onPress: () => {
                void active.refetch();
              },
            }}
            density="coach"
            testID="exercise-library-error"
          />
        ) : total === 0 ? (
          <EmptyState
            icon={<Dumbbell size={22} color={theme.colors.brand.DEFAULT} />}
            title={isSearching ? 'Nothing matches that' : 'Nothing of your own yet'}
            body={
              isSearching
                ? 'Try a shorter word, or add this as your own exercise.'
                : 'The global library covers most programs. Add your own when a gym has a machine we do not.'
            }
            primaryAction={{
              label: isSearching ? `Create "${trimmedQuery}"` : 'Create exercise',
              onPress: () => {
                onCreate(isSearching ? trimmedQuery : undefined);
              },
            }}
            density="coach"
            testID="exercise-library-empty"
          />
        ) : (
          <>
            {rows.mine.length > 0 ? (
              <Section
                label="Your exercises"
                exercises={rows.mine}
                isCustom
                onOpen={(id) => {
                  onOpen(id, true);
                }}
              />
            ) : null}
            {rows.global.length > 0 ? (
              <Section
                label="Global library"
                exercises={rows.global}
                isCustom={false}
                onOpen={(id) => {
                  onOpen(id, false);
                }}
              />
            ) : null}

            {/* The search found something, but maybe not the thing. Keeping
                the create row visible is what stops a coach concluding the
                movement does not exist and giving up. */}
            {isSearching ? (
              <View style={styles.searchCreate}>
                <Button
                  variant="secondary"
                  density="coach"
                  fullWidth
                  onPress={() => {
                    onCreate(trimmedQuery);
                  }}
                  iconLeft={<Plus size={16} color={theme.colors.fg.glass} />}
                  testID="create-from-search"
                >
                  {`Create "${trimmedQuery}"`}
                </Button>
              </View>
            ) : null}

            {!isSearching && library.hasNextPage ? (
              <View style={styles.searchCreate}>
                <Button
                  variant="secondary"
                  density="coach"
                  fullWidth
                  loading={library.isFetchingNextPage}
                  onPress={() => {
                    void library.fetchNextPage();
                  }}
                  testID="load-more-exercises"
                >
                  Load more
                </Button>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing(12) }]}>
        <Button
          density="coach"
          fullWidth
          onPress={() => {
            onCreate();
          }}
          iconLeft={<Plus size={16} color={theme.colors.fg.onBrand} />}
          testID="create-exercise"
        >
          Create exercise
        </Button>
      </View>
    </View>
  );
}

interface SectionProps {
  label: string;
  exercises: readonly LibraryExercise[];
  isCustom: boolean;
  onOpen: (exerciseId: string) => void;
}

function Section({ label, exercises, isCustom, onOpen }: SectionProps) {
  const theme = useTheme();
  const themed = useThemedStyles();

  return (
    <View style={styles.section}>
      <Text size="eyebrow" tone="muted">
        {label}
      </Text>
      <Card elevation="raised">
        {exercises.map((exercise, index) => (
          <Pressable
            key={exercise.id}
            onPress={() => {
              onOpen(exercise.id);
            }}
            accessibilityRole="button"
            accessibilityLabel={exercise.name}
            // A global row opens read-only; saying so up front is cheaper
            // than a coach discovering it at the point of editing.
            accessibilityHint={isCustom ? 'Opens for editing' : 'Global exercise, view only'}
            style={[styles.row, index < exercises.length - 1 ? themed.divider : null]}
            testID={`exercise-row-${exercise.id}`}
          >
            <View style={[styles.tile, isCustom ? themed.tileCustom : themed.tileGlobal]}>
              <Dumbbell
                size={15}
                color={isCustom ? theme.colors.brand.DEFAULT : theme.colors.fg.muted}
              />
            </View>
            <View style={styles.flex}>
              <Text size="label" numberOfLines={1}>
                {exercise.name}
              </Text>
              <Text size="caption" tone="subtle" numberOfLines={1}>
                {`${exercise.primaryMuscle} · ${exercise.equipment}`}
              </Text>
            </View>
            {isCustom ? <Badge tone="brand" size="sm" label="Yours" /> : null}
            <ChevronRight size={15} color={theme.colors.fg.faint} />
          </Pressable>
        ))}
      </Card>
    </View>
  );
}

const TILE = 34;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: GUTTER, gap: spacing(12) },
  subtitle: { marginTop: -spacing(8) },
  search: { marginTop: spacing(4) },
  filters: { gap: spacing(7), paddingRight: GUTTER },
  section: { gap: spacing(9) },
  row: {
    minHeight: density.coach.row,
    paddingHorizontal: spacing(14),
    paddingVertical: spacing(9),
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(12),
  },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  searchCreate: { marginTop: spacing(4) },
  footer: { paddingHorizontal: GUTTER, paddingTop: spacing(12) },
});

const useThemedStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.colors.bg.DEFAULT },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.border.soft },
  tileCustom: { backgroundColor: t.colors.bg.raised, borderColor: t.colors.brand.shade },
  tileGlobal: { backgroundColor: t.colors.bg.inset, borderColor: t.colors.border.strong },
}));
