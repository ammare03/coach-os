import { exercises as exercisesSchemas } from '@coachos/schemas';
import {
  Badge,
  Card,
  Chip,
  createThemedStyles,
  density,
  EmptyState,
  Input,
  LoadingState,
  Pressable,
  radius,
  Sheet,
  SheetHeader,
  spacing,
  Text,
  useTheme,
} from '@coachos/ui';
import { Dumbbell, Play, Plus, WifiOff } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDebounced } from '../../../../hooks/useDebounced.ts';
import { useResourceState } from '../../../../lib/query/useResourceState.ts';
import { useExercisePickerSearch, type PickerExercise } from '../../api/exercises.ts';

// The one sheet every other feature opens to choose an exercise
// (`exercise-library/05`) — `program-builder/02` today,
// `phase-09-workout-logger/session-modifications/02` (swap mid-set, in a
// basement) next. Built here rather than in either consumer so the second
// one does not duplicate a search UI.
//
// Three decisions from the approved design, each load-bearing:
//
// 1. **No commit footer.** This picker is SINGLE-select: the tap is the
//    commit and the sheet leaves immediately. A footer would add a second
//    tap to the most repeated action in program authoring.
//
//    `features/onboarding/components/ExercisePickerSheet.tsx` (P06) stays a
//    SEPARATE component and is not merged into this one. It is multi-select
//    with a counting commit footer, which `DESIGN.md` §10.8 requires and
//    which this design explicitly removes; merging them would mean one
//    component whose footer, selection model, row affordance (checkbox vs
//    tap-to-commit) and empty state all fork on a `mode` prop — the forked
//    component `CLAUDE.md` §1.1 forbids, wearing a prop. They share the
//    procedure, which is the part worth sharing.
// 2. **One ranked list, not the library screen's your/global split.**
//    `exercises.search` already ranks a coach's own exercises first
//    (`services/exercises/visibility.ts` `customFirst`); sectioning a
//    six-result answer costs two headings and buys nothing when the job is
//    "pick this one". A coach's own row carries a "Yours" badge instead.
// 3. **The create row survives a SUCCESSFUL search.** A fuzzy hit is the
//    exact moment a coach concludes the movement does not exist and gives
//    up, so both doors stay open.

export type { PickerExercise };

const PATTERNS = exercisesSchemas.movementPatternValue.options;
type MovementPattern = (typeof PATTERNS)[number];

const PATTERN_LABEL: Record<MovementPattern, string> = {
  squat: 'Squat',
  hinge: 'Hinge',
  push: 'Push',
  pull: 'Pull',
  carry: 'Carry',
  core: 'Core',
  isolation: 'Isolation',
  other: 'Other',
};

const GUTTER = density.coach.gutter;
const TILE = 34;
const PIP = 15;

/**
 * §19 budgets 400ms from keystroke to results for the whole path, and
 * `exercises.search` owns most of it. 200ms is the share we can spend on
 * "has the coach stopped typing" without the list feeling detached from
 * the field — and `keepPreviousData` (`../../api/exercises.ts`) means the
 * previous answer stays on screen for that window rather than a skeleton.
 */
const SEARCH_DEBOUNCE_MS = 200;

/**
 * `@gorhom/bottom-sheet` positions its content view `position: absolute;
 * top: 0` with no height, so a `flex: 1` child inside a `Sheet` collapses
 * to nothing and a long list renders past the bottom edge instead of
 * scrolling. The results list therefore carries an explicit ceiling: the
 * sheet's own 90% of the window (`snap="full"`), less the chrome standing
 * above it — grabber, header, search field, filter row.
 */
const SHEET_FRACTION = 0.9;
const SHEET_CHROME = 210;
const MIN_LIST_HEIGHT = 220;

/** Stable identity, so a caller that omits the prop does not re-render the list. */
const NO_IDS: readonly string[] = [];

export interface ExercisePickerSheetProps {
  isOpen: boolean;
  /** Names what the choice is for — "Add to Day 3", "Swap Barbell Back Squat". */
  title: string;
  /** Says what a tap does, because the tap is the commit. */
  subtitle?: string | undefined;
  /** Opens with a pattern pre-applied — a swap already knows what it is replacing. */
  initialMovementPattern?: MovementPattern | null | undefined;
  /** Already on the target. Shown dimmed and inert, never offered twice. */
  alreadyAdded?: readonly string[] | undefined;
  /** What the dimmed rows are badged with. "On this day" for a program day. */
  alreadyAddedLabel?: string | undefined;
  onSelect: (exercise: PickerExercise) => void;
  /**
   * Omit to hide every create affordance — a consumer that cannot author an
   * exercise (a mid-session swap, before P09 wires authoring into the
   * logger) should not offer one and then dead-end.
   */
  onCreate?: ((prefilledName: string) => void) | undefined;
  onDismiss: () => void;
}

export function ExercisePickerSheet({
  isOpen,
  title,
  subtitle = 'Tap one to add it',
  initialMovementPattern = null,
  alreadyAdded = NO_IDS,
  alreadyAddedLabel = 'On this day',
  onSelect,
  onCreate,
  onDismiss,
}: ExercisePickerSheetProps) {
  const [query, setQuery] = useState('');
  const [pattern, setPattern] = useState<MovementPattern | null>(initialMovementPattern);

  // A fresh sheet every time it opens — a query or a filter carried over
  // from the last day would silently narrow a search the coach never made.
  //
  // Adjusted during render against the previous `isOpen` rather than in an
  // effect: React's own documented pattern for "reset state when a prop
  // changes", and the one the `react-hooks` rules here require.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setQuery('');
      setPattern(initialMovementPattern);
    }
  }

  return (
    <Sheet isOpen={isOpen} onDismiss={onDismiss} snap="full" testID="exercise-picker">
      <SheetHeader title={title} subtitle={subtitle} onClose={onDismiss} density="coach" />

      {/* Field and filters are live from the first frame — only the list is
          unknown while the first search runs. */}
      <View style={styles.controls}>
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Search exercises"
          accessibilityLabel="Search exercises"
          returnKeyType="search"
          autoCorrect={false}
          density="coach"
          testID="exercise-picker-search"
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.filters}
        >
          <Chip
            label="All"
            selected={pattern === null}
            density="coach"
            onPress={() => {
              setPattern(null);
            }}
            testID="picker-filter-all"
          />
          {PATTERNS.map((value) => (
            <Chip
              key={value}
              label={PATTERN_LABEL[value]}
              selected={pattern === value}
              density="coach"
              onPress={() => {
                setPattern(pattern === value ? null : value);
              }}
              testID={`picker-filter-${value}`}
            />
          ))}
        </ScrollView>
      </View>

      <PickerResults
        query={query}
        pattern={pattern}
        alreadyAdded={alreadyAdded}
        alreadyAddedLabel={alreadyAddedLabel}
        onSelect={onSelect}
        onCreate={onCreate}
        onDismiss={onDismiss}
        onClearSearch={() => {
          setQuery('');
        }}
      />
    </Sheet>
  );
}

interface PickerResultsProps {
  query: string;
  pattern: MovementPattern | null;
  alreadyAdded: readonly string[];
  alreadyAddedLabel: string;
  onSelect: (exercise: PickerExercise) => void;
  onCreate: ((prefilledName: string) => void) | undefined;
  onDismiss: () => void;
  onClearSearch: () => void;
}

function PickerResults({
  query,
  pattern,
  alreadyAdded,
  alreadyAddedLabel,
  onSelect,
  onCreate,
  onDismiss,
  onClearSearch,
}: PickerResultsProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  const debouncedQuery = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const search = useExercisePickerSearch(
    { query: debouncedQuery, movementPattern: pattern ?? undefined },
    true,
  );
  const resource = useResourceState(search);

  // The query the coach can SEE, not the debounced one — the create row has
  // to say what is in the field, or it offers to create the previous word.
  const typed = query.trim();
  const maxHeight = Math.max(
    MIN_LIST_HEIGHT,
    height * SHEET_FRACTION - SHEET_CHROME - insets.bottom,
  );

  let body: ReactNode;

  if (resource.state === 'loading') {
    body = (
      <LoadingState shape="list" rows={6} density="coach" accessibilityLabel="Loading exercises" />
    );
  } else if (resource.state === 'success') {
    const results = resource.data;
    // The three tiers are appended in order (exact → full-text → trigram),
    // so "every row is fuzzy" is the same statement as "nothing actually
    // matched" — and that is the one case worth a heading, because the
    // coach's spelling and the library's disagree.
    const allFuzzy = results.length > 0 && results.every((row) => row.matchKind === 'fuzzy');

    body = (
      <>
        {/* `UI-UX.md` §UX4's offline row: cached content plus a calm note,
            never an error. A swap mid-set must not wait on a round trip. */}
        {resource.refetchError !== null ? <StaleNote /> : null}

        {results.length === 0 ? (
          <NothingMatches
            query={typed}
            onCreate={onCreate}
            onClearSearch={onClearSearch}
            onDismiss={onDismiss}
          />
        ) : (
          <>
            {allFuzzy ? (
              <Text size="eyebrow" tone="muted" style={styles.hint}>
                Closest matches
              </Text>
            ) : null}
            <Card elevation="raised" density="coach">
              {results.map((exercise, index) => (
                <ExerciseRow
                  key={exercise.id}
                  exercise={exercise}
                  isLast={index === results.length - 1}
                  disabledLabel={alreadyAdded.includes(exercise.id) ? alreadyAddedLabel : null}
                  onSelect={(chosen) => {
                    onSelect(chosen);
                    onDismiss();
                  }}
                />
              ))}
            </Card>

            {onCreate && typed.length > 0 ? (
              <CreateRow
                label={`Create “${typed}”`}
                onPress={() => {
                  onCreate(typed);
                  onDismiss();
                }}
              />
            ) : null}
          </>
        )}
      </>
    );
  } else {
    // Nothing cached and nothing reachable. The design has no board for
    // this — it assumes the P08 prefetch has already put the library on the
    // device — so it stays as calm as the offline board and never blocks
    // the field or the filters above it.
    body = (
      <LibraryUnreachable
        onRetry={() => {
          void search.refetch();
        }}
      />
    );
  }

  return (
    <ScrollView
      style={{ maxHeight }}
      contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing(22) }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      testID="exercise-picker-results"
    >
      {body}
    </ScrollView>
  );
}

interface NothingMatchesProps {
  query: string;
  onCreate: ((prefilledName: string) => void) | undefined;
  onClearSearch: () => void;
  onDismiss: () => void;
}

function NothingMatches({ query, onCreate, onClearSearch, onDismiss }: NothingMatchesProps) {
  const theme = useTheme();
  const canCreate = onCreate !== undefined && query.length > 0;

  return (
    <EmptyState
      icon={<Dumbbell size={22} color={theme.colors.brand.DEFAULT} />}
      title="Nothing matches that"
      body={shorterWordHint(query)}
      // `EmptyState` takes exactly one action by type, and that is the
      // point here: creating the thing the coach just searched for is the
      // step forward, and clearing the search is only the fallback when
      // this consumer cannot author.
      primaryAction={
        canCreate
          ? {
              label: `Create “${query}”`,
              onPress: () => {
                onCreate(query);
                onDismiss();
              },
            }
          : { label: 'Clear search', onPress: onClearSearch }
      }
      density="coach"
      testID="exercise-picker-empty"
    />
  );
}

/**
 * The empty state carries the query the coach already typed rather than
 * generic advice — "curl" rather than "jefferson curl" is a next step, "try
 * a shorter word" on its own is not. Exported for its own test: the
 * single-word case has no shorter word to suggest and must not invent one.
 */
export function shorterWordHint(query: string): string {
  const words = query.split(/\s+/).filter((word) => word.length > 0);
  const last = words[words.length - 1];
  if (words.length < 2 || last === undefined) {
    return 'Try a shorter word, or add it as your own exercise.';
  }
  return `Try a shorter word — “${last}” rather than “${query}” — or add it as your own.`;
}

interface ExerciseRowProps {
  exercise: PickerExercise;
  isLast: boolean;
  /** Non-null means "already on the target": dimmed, badged, and not selectable. */
  disabledLabel: string | null;
  onSelect: (exercise: PickerExercise) => void;
}

function ExerciseRow({ exercise, isLast, disabledLabel, onSelect }: ExerciseRowProps) {
  const theme = useTheme();
  const themed = useThemedStyles();
  const isDisabled = disabledLabel !== null;
  const hasDemo = exercise.demoAssetId !== null;

  // Both badges and the demo pip are silent to a screen reader by
  // construction (`Badge`'s own contract), so the row folds them into its
  // own label. A shape or a colour that carries meaning has to say it in
  // words too (`accessibility` §2, `DESIGN.md` §8).
  const label = [
    exercise.name,
    exercise.isCustom ? 'your exercise' : null,
    hasDemo ? 'has a demo video' : null,
    disabledLabel,
  ]
    .filter((part): part is string => part !== null)
    .join(', ');

  return (
    <Pressable
      disabled={isDisabled}
      onPress={() => {
        onSelect(exercise);
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={isDisabled ? undefined : 'Chooses this exercise and closes the picker'}
      accessibilityState={{ disabled: isDisabled }}
      style={[styles.row, isDisabled ? styles.rowDimmed : null, isLast ? null : themed.divider]}
      testID={`picker-exercise-${exercise.id}`}
    >
      <View style={styles.tileWrap}>
        <View style={[styles.tile, exercise.isCustom ? themed.tileCustom : themed.tileGlobal]}>
          <Dumbbell
            size={15}
            color={exercise.isCustom ? theme.colors.brand.DEFAULT : theme.colors.fg.muted}
          />
        </View>
        {hasDemo ? (
          <View style={[styles.pip, themed.pip]}>
            <Play size={8} color={theme.colors.brand.DEFAULT} fill={theme.colors.brand.DEFAULT} />
          </View>
        ) : null}
      </View>

      <View style={styles.rowText}>
        <Text size="label" numberOfLines={1}>
          {exercise.name}
        </Text>
        <Text size="caption" tone="muted" numberOfLines={1}>
          {`${exercise.primaryMuscle} · ${exercise.equipment} · ${PATTERN_LABEL[exercise.movementPattern]}`}
        </Text>
      </View>

      {exercise.isCustom ? <Badge tone="brand" size="sm" label="Yours" /> : null}
      {isDisabled ? <Badge tone="neutral" size="sm" label={disabledLabel} /> : null}
    </Pressable>
  );
}

function CreateRow({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  const themed = useThemedStyles();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.createRow, themed.createRow]}
      testID="picker-create"
    >
      <Plus size={16} color={theme.colors.brand.DEFAULT} />
      <Text size="label" tone="warm" numberOfLines={1} style={styles.createText}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Nothing cached and nothing reachable. The design has no board for this —
 * it assumes `phase-08-offline-core/prefetch/01` has already put the
 * library on the device — so it stays as calm as the offline board and
 * never blocks the field or the filters above it.
 *
 * `brand.mid` and not a red: `DESIGN.md` §8 reserves the `state.*` ramp and
 * `urgent` for adherence (enforced by the `adherence-colors-only` lint
 * rule), and a failed fetch is not an adherence signal.
 */
function LibraryUnreachable({ onRetry }: { onRetry: () => void }) {
  const theme = useTheme();

  return (
    <EmptyState
      icon={<WifiOff size={22} color={theme.colors.brand.mid} />}
      title="We couldn’t reach the library"
      body="There is nothing saved on this device yet. Anything already logged is unaffected."
      primaryAction={{ label: 'Try again', onPress: onRetry }}
      density="coach"
      testID="exercise-picker-error"
    />
  );
}

/**
 * Said once, quietly, above what the picker does have. Deliberately NOT
 * "you're offline": without a connectivity signal on the device we cannot
 * honestly claim which of the two it is, and the design's own note says a
 * network error is treated the same way regardless.
 */
function StaleNote() {
  const theme = useTheme();
  const themed = useThemedStyles();

  return (
    <View style={[styles.note, themed.note]} testID="exercise-picker-stale">
      <WifiOff size={15} color={theme.colors.fg.muted} style={styles.noteIcon} />
      <Text size="caption" tone="muted" style={styles.noteText}>
        We couldn’t refresh the library just now. These are the exercises saved on this device.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  controls: {
    paddingHorizontal: GUTTER,
    paddingTop: spacing(12),
    gap: spacing(11),
  },
  filters: { gap: spacing(7), paddingRight: GUTTER },
  list: {
    paddingHorizontal: GUTTER,
    paddingTop: spacing(14),
    gap: spacing(11),
  },
  hint: { marginBottom: -spacing(4) },
  // No horizontal padding of its own: `Card density="coach"` already insets
  // its children by 14, which is the design's row inset. Adding the row's
  // own would double it.
  row: {
    minHeight: density.coach.row,
    paddingVertical: spacing(9),
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(12),
  },
  rowDimmed: { opacity: 0.5 },
  rowText: { flex: 1, minWidth: 0 },
  tileWrap: { position: 'relative' },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  pip: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: PIP,
    height: PIP,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createRow: {
    minHeight: 52,
    paddingHorizontal: spacing(14),
    paddingVertical: spacing(9),
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(12),
    borderRadius: radius.card,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  createText: { flex: 1, minWidth: 0 },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing(9),
    paddingHorizontal: spacing(12),
    paddingVertical: spacing(10),
    borderRadius: radius.control,
  },
  noteIcon: { marginTop: 2 },
  noteText: { flex: 1, minWidth: 0 },
});

const useThemedStyles = createThemedStyles((t) => ({
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.border.soft },
  tileCustom: { backgroundColor: t.colors.bg.raised, borderColor: t.colors.brand.shade },
  tileGlobal: { backgroundColor: t.colors.bg.inset, borderColor: t.colors.border.strong },
  pip: { backgroundColor: t.colors.bg.DEFAULT, borderColor: t.colors.brand.shade },
  // `elevation.tinted`'s second stop is `brand.DEFAULT` at 7% — the same
  // wash `DESIGN.md` §2 gives an L3 tinted card, which is what the dashed
  // create row is a variant of. There is no separate token for it.
  createRow: {
    backgroundColor: t.elevation.tinted.gradient[1],
    borderColor: t.colors.brand.shade,
  },
  note: { backgroundColor: t.control.surface },
}));
