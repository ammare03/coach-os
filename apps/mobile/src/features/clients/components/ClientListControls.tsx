import {
  Chip,
  Input,
  SegmentedControl,
  Text,
  createThemedValue,
  spacing,
  type SegmentedOptions,
} from '@coachos/ui';
import { Check, ListFilter } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import {
  FILTERABLE_GOALS,
  FILTERABLE_STATUSES,
  type ClientGoalFilter,
  type ClientListFilters,
  type ClientSort,
  type ClientStatusFilter,
} from '../hooks/useClientListFilters.ts';

// §8.2's three controls, between the adherence key and the first client row.
// Presentation only: every piece of state lives in `useClientListFilters`,
// so this file has one `useState` and it is about whether a panel is open.
//
// Nothing here is a new primitive. The field is `Input`, the sort is
// `SegmentedControl`, every filter is a `Chip` — `code-conventions` §1's
// rule read the other way round: a fourth way to render a small labelled
// control is the thing worth not building.

/**
 * Coach register (`product-copy` §4): dense, and abbreviating freely. These
 * are the screen's words, not the enum's — rewording one is a copy change.
 */
const SORT_LABEL: Record<ClientSort, string> = {
  attention: 'Attention',
  name: 'Name',
  'last-active': 'Last active',
};

const STATUS_LABEL: Record<ClientStatusFilter, string> = {
  active: 'Active',
  invited: 'Invited',
};

const GOAL_LABEL: Record<ClientGoalFilter, string> = {
  fat_loss: 'Fat loss',
  muscle_gain: 'Muscle gain',
  performance: 'Performance',
  health: 'Health',
  other: 'Other',
};

const SORT_OPTIONS: SegmentedOptions<ClientSort> = [
  { value: 'attention', label: SORT_LABEL.attention },
  { value: 'name', label: SORT_LABEL.name },
  { value: 'last-active', label: SORT_LABEL['last-active'] },
];

/**
 * Past this font scale the segmented control becomes wrapping chips.
 *
 * Three segments share the width of one phone, so each holds about a third
 * of it; at 1.3 "Last active" no longer fits its share and `SegmentedControl`
 * truncates it to one line, which is the one thing a sort option may not do
 * — a coach cannot choose an option they cannot read. `accessibility` §3's
 * sanctioned answer to exactly this is to reflow past a threshold rather
 * than to clip or to disable scaling. The chips carry the same
 * single-select semantics and grow instead.
 */
const SORT_REFLOW_FONT_SCALE = 1.3;

export interface ClientListControlsProps {
  filters: ClientListFilters;
  testID?: string;
}

export function ClientListControls({ filters, testID }: ClientListControlsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { fontScale } = useWindowDimensions();
  const sortAsChips = fontScale >= SORT_REFLOW_FONT_SCALE;

  const { activeFilterCount } = filters;
  const toggleLabel =
    activeFilterCount === 0 ? 'Filters' : `Filters · ${String(activeFilterCount)}`;
  // The expanded state and the active count both said in words, because the
  // pill and the count badge are colour and glyph — and `Chip` has no
  // `expanded` state to set (`accessibility` §2, §4).
  const toggleSpokenLabel =
    `${isOpen ? 'Hide filters' : 'Show filters'}` +
    (activeFilterCount === 0 ? '' : `, ${String(activeFilterCount)} active`);

  return (
    <View style={styles.root} testID={testID}>
      <Input
        value={filters.draftQuery}
        onChangeText={filters.setQuery}
        placeholder="Search clients"
        density="coach"
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel="Search clients"
        testID="client-search"
      />

      {filters.isNarrowed ? (
        <Text
          size="micro"
          tone="muted"
          // Announced when it changes rather than only when focus lands on
          // it: the coach's own typing is what moved the number, and a
          // silently-updated count is invisible to a screen reader
          // (`accessibility` §2).
          accessibilityLiveRegion="polite"
          testID="client-list-count"
        >
          {describeCount(filters.clients.length, filters.totalCount)}
        </Text>
      ) : null}

      {sortAsChips ? (
        <View>
          <Text size="eyebrow" tone="muted" style={styles.facet}>
            SORT
          </Text>
          <View style={styles.chips}>
            {SORT_OPTIONS.map((option) => (
              <FilterChip
                key={option.value}
                label={option.label}
                spokenLabel={`Sort by ${option.label.toLowerCase()}`}
                selected={filters.sort === option.value}
                onPress={() => {
                  filters.setSort(option.value);
                }}
              />
            ))}
          </View>
        </View>
      ) : (
        <SegmentedControl
          options={SORT_OPTIONS}
          value={filters.sort}
          onChange={filters.setSort}
          density="coach"
          testID="client-sort"
        />
      )}

      <View style={styles.chips}>
        <Chip
          label={toggleLabel}
          selected={activeFilterCount > 0}
          iconLeft={<FilterGlyph selected={activeFilterCount > 0} />}
          onPress={() => {
            setIsOpen((open) => !open);
          }}
          accessibilityLabel={toggleSpokenLabel}
          testID="client-filters-toggle"
        />

        {/* Closed, every live filter stays on screen as its own removable
            chip. A filter in force behind a folded panel is a shortened
            list with no visible reason for it. */}
        {isOpen
          ? null
          : activeChips(filters).map((chip) => (
              <Chip
                key={chip.spokenLabel}
                label={chip.label}
                selected
                onRemove={chip.onRemove}
                accessibilityLabel={chip.spokenLabel}
              />
            ))}
      </View>

      {isOpen ? (
        <View style={styles.panel} testID="client-filters-panel">
          <Facet name="STATUS">
            {FILTERABLE_STATUSES.map((status) => (
              <FilterChip
                key={status}
                label={STATUS_LABEL[status]}
                spokenLabel={`${STATUS_LABEL[status]} status`}
                selected={filters.statuses.includes(status)}
                onPress={() => {
                  filters.toggleStatus(status);
                }}
              />
            ))}
          </Facet>

          <Facet name="GOAL">
            {FILTERABLE_GOALS.map((goal) => (
              <FilterChip
                key={goal}
                label={GOAL_LABEL[goal]}
                spokenLabel={`${GOAL_LABEL[goal]} goal`}
                selected={filters.goals.includes(goal)}
                onPress={() => {
                  filters.toggleGoal(goal);
                }}
              />
            ))}
          </Facet>

          {activeFilterCount > 0 ? (
            <View style={styles.chips}>
              <Chip label="Clear filters" onPress={filters.clearFilters} />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

interface FilterChipProps {
  label: string;
  /** What a screen reader says — "Active" alone names neither the facet nor the act. */
  spokenLabel: string;
  selected: boolean;
  onPress: () => void;
}

/**
 * A chip whose on state is the selection pill, a check glyph, AND
 * `accessibilityState.selected` — three channels, so the row survives
 * greyscale and a screen reader alike (`accessibility` §4).
 */
function FilterChip({ label, spokenLabel, selected, onPress }: FilterChipProps) {
  return (
    <Chip
      label={label}
      selected={selected}
      onPress={onPress}
      iconLeft={selected ? <SelectedGlyph /> : undefined}
      accessibilityLabel={spokenLabel}
    />
  );
}

function SelectedGlyph() {
  const color = useSelectedIconColor();
  return <Check size={12} color={color} />;
}

function FilterGlyph({ selected }: { selected: boolean }) {
  const selectedColor = useSelectedIconColor();
  const restingColor = useRestingIconColor();
  return <ListFilter size={12} color={selected ? selectedColor : restingColor} />;
}

function Facet({ name, children }: { name: string; children: ReactNode }) {
  return (
    <View>
      <Text size="eyebrow" tone="muted" style={styles.facet}>
        {name}
      </Text>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

interface ActiveChip {
  label: string;
  spokenLabel: string;
  onRemove: () => void;
}

/** Status first, then goal — the same order the open panel draws them in. */
function activeChips(filters: ClientListFilters): ActiveChip[] {
  return [
    ...filters.statuses.map((status) => ({
      label: STATUS_LABEL[status],
      spokenLabel: `${STATUS_LABEL[status]} status`,
      onRemove: () => {
        filters.toggleStatus(status);
      },
    })),
    ...filters.goals.map((goal) => ({
      label: GOAL_LABEL[goal],
      spokenLabel: `${GOAL_LABEL[goal]} goal`,
      onRemove: () => {
        filters.toggleGoal(goal);
      },
    })),
  ];
}

/** Facts, never a verdict on the filter (`product-copy` §1). */
function describeCount(shown: number, total: number): string {
  return `${String(shown)} of ${String(total)} ${total === 1 ? 'client' : 'clients'}`;
}

const styles = StyleSheet.create({
  root: { gap: spacing(8), paddingTop: spacing(12), paddingBottom: spacing(10) },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(8), alignItems: 'center' },
  panel: { gap: spacing(9) },
  facet: { marginBottom: spacing(5) },
});

const useSelectedIconColor = createThemedValue((t) => t.colors.fg.bright);
const useRestingIconColor = createThemedValue((t) => t.colors.fg.muted);
