import {
  Badge,
  Card,
  createThemedStyles,
  density,
  EmptyState,
  IconButton,
  LoadingState,
  radius,
  spacing,
  Text,
  useTheme,
} from '@coachos/ui';
import { formatRelativeToNow } from '@coachos/utils';
import { LayoutGrid, Plus, TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCreateProgram, useProgramTemplates, type ProgramTemplate } from '../api/programs.ts';
import {
  ProgramDetailsSheet,
  type ProgramDetailsValues,
} from '../components/ProgramDetailsSheet.tsx';

// `(coach)/(tabs)/programs` — the Programs tab's default view
// (`program-templates/01`, frame A/B). A Scan list (`UI-UX.md` §UX2):
// one query, no waterfall, and the coach's own vocabulary before anything
// else.
//
// **Live-reference, not snapshot** (`program-templates/04`'s resolution,
// carried into `ProgramDetailsSheet`'s toggle copy): a template listed here
// is the exact row an assignment will point at, so nothing this screen
// renders is a point-in-time copy — it is the coach's actual, currently
// assignable library.
//
// No kebab on a row yet. Its menu is `Duplicate` (task 02) and `Archive`
// (task 03) — both API-only in this task, so the affordance arrives with
// the task that gives it something to do, per the design note.
//
// `ScrollView` + `.map()`, not `FlashList`: the same call `ExerciseLibraryScreen`
// makes for its own scan list — a coach's template count is small, and a
// "Load more" row reads better here than virtualising a handful of cards.

const GUTTER = density.coach.gutter;

export interface ProgramTemplatesScreenProps {
  onOpenProgram: (programId: string) => void;
}

export function ProgramTemplatesScreen({ onOpenProgram }: ProgramTemplatesScreenProps) {
  const theme = useTheme();
  const themed = useThemedStyles();
  const insets = useSafeAreaInsets();

  const templates = useProgramTemplates();
  const createProgram = useCreateProgram();

  const [isCreateOpen, setCreateOpen] = useState(false);

  const items = templates.data?.pages.flatMap((page) => page.items) ?? [];

  function createAndOpen(values: ProgramDetailsValues): void {
    createProgram.mutate(
      {
        name: values.name,
        ...(values.description.length > 0 ? { description: values.description } : {}),
        durationWeeks: values.durationWeeks,
      },
      {
        onSuccess: (result) => {
          setCreateOpen(false);
          onOpenProgram(result.id);
        },
      },
    );
  }

  return (
    <View style={[styles.flex, themed.screen]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + spacing(6), paddingBottom: insets.bottom + spacing(52) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.grow}>
            <Text size="h1">Programs</Text>
            <Text size="micro" tone="muted">
              Reusable templates you can assign to anyone
            </Text>
          </View>
          <IconButton
            icon={<Plus size={18} color={theme.colors.brand.DEFAULT} />}
            variant="secondary"
            size="sm"
            onPress={() => {
              setCreateOpen(true);
            }}
            accessibilityLabel="New program"
            testID="new-program-header"
          />
        </View>

        {templates.isPending ? (
          <LoadingState shape="list" rows={5} accessibilityLabel="Loading your programs" />
        ) : templates.isError ? (
          <EmptyState
            icon={<TriangleAlert size={22} color={theme.colors.brand.mid} />}
            title="We couldn't load your programs"
            body="Check your connection and try again. Nothing you have built is affected."
            primaryAction={{
              label: 'Try again',
              onPress: () => {
                void templates.refetch();
              },
            }}
            density="coach"
            testID="programs-error"
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<LayoutGrid size={22} color={theme.colors.fg.muted} />}
            title="No templates yet"
            body="Build a program once and reuse it with every client who needs it."
            primaryAction={{
              label: 'New program',
              onPress: () => {
                setCreateOpen(true);
              },
            }}
            density="coach"
            testID="programs-empty"
          />
        ) : (
          <>
            {items.map((template) => (
              <TemplateRow
                key={template.id}
                template={template}
                onPress={() => {
                  onOpenProgram(template.id);
                }}
              />
            ))}

            {templates.hasNextPage ? (
              <Pressable
                onPress={() => {
                  void templates.fetchNextPage();
                }}
                disabled={templates.isFetchingNextPage}
                accessibilityRole="button"
                accessibilityLabel="Load more programs"
                style={styles.loadMore}
              >
                <Text size="body-sm" tone="muted">
                  {templates.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={() => {
                setCreateOpen(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="New program"
              style={[styles.ghost, themed.ghostBorder]}
              testID="new-program-ghost"
            >
              <Plus size={16} color={theme.colors.brand.DEFAULT} />
              <Text size="body-sm" tone="warm">
                New program
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      {isCreateOpen ? (
        <ProgramDetailsSheet
          isOpen
          mode="create"
          isSaving={createProgram.isPending}
          onDismiss={() => {
            setCreateOpen(false);
          }}
          onSave={createAndOpen}
        />
      ) : null}
    </View>
  );
}

interface TemplateRowProps {
  template: ProgramTemplate;
  onPress: () => void;
}

function TemplateRow({ template, onPress }: TemplateRowProps) {
  const weeksLabel = `${String(template.durationWeeks)} wk`;
  const daysLabel =
    template.daysPerWeek === 1 ? '1 day/week' : `${String(template.daysPerWeek)} days/week`;
  const exercisesLabel =
    template.exerciseCount === 1 ? '1 exercise' : `${String(template.exerciseCount)} exercises`;
  const meta = `${daysLabel} · ${exercisesLabel} · edited ${formatRelativeToNow(template.updatedAt)}`;

  return (
    <Card
      elevation="raised"
      density="coach"
      onPress={onPress}
      accessibilityLabel={`${template.name}, ${weeksLabel}, ${meta}`}
      testID={`template-row-${template.id}`}
    >
      <View style={styles.row}>
        <View style={styles.grow}>
          <View style={styles.rowTitle}>
            <Text size="label" numberOfLines={1}>
              {template.name}
            </Text>
            <Badge tone="neutral" size="sm" label={weeksLabel} />
          </View>
          <Text size="micro" tone="muted" numberOfLines={1} style={styles.rowMeta}>
            {meta}
          </Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  scroll: { paddingHorizontal: GUTTER, gap: spacing(9) },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(12),
    paddingBottom: spacing(6),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(11),
    paddingVertical: spacing(4),
  },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing(8) },
  rowMeta: { marginTop: spacing(3) },
  loadMore: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghost: {
    minHeight: 48,
    marginTop: spacing(4),
    borderRadius: radius.full,
    borderWidth: 1,
    borderStyle: 'dashed',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(8),
  },
});

const useThemedStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.colors.bg.DEFAULT },
  ghostBorder: { borderColor: t.colors.border.strong },
}));
