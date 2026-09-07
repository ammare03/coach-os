import {
  Badge,
  createThemedStyles,
  density,
  EmptyState,
  ForbiddenState,
  IconButton,
  LoadingState,
  NotFoundState,
  Pressable,
  radius,
  spacing,
  Text,
  useTheme,
} from '@coachos/ui';
import {
  CalendarPlus,
  ChevronLeft,
  Plus,
  SlidersHorizontal,
  TriangleAlert,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getErrorCode } from '../../../lib/error-code.ts';
import type { ProgramWeek } from '../api/programs.ts';
import { AddDaySheet } from '../components/AddDaySheet.tsx';
import { ACTION_BAR_BOTTOM, BuilderActionBar } from '../components/BuilderActionBar.tsx';
import { ProgramDetailsSheet } from '../components/ProgramDetailsSheet.tsx';
import { WeekCard } from '../components/WeekCard.tsx';
import { useProgramBuilder } from '../hooks/useProgramBuilder.ts';

// `(coach)/program/[id]` — the builder (`program-builder/01`, frame 1a).
// Coach density throughout: 16px gutter, 56px rows, 46px buttons.
//
// One query, no waterfall (`UI-UX.md` §UX3): `programs.get` returns the
// whole program → weeks → days hierarchy, so the screen has exactly one
// loading state and one error boundary rather than one per level.

const GUTTER = density.coach.gutter;

export interface ProgramBuilderScreenProps {
  programId: string;
  onBack: () => void;
  onOpenDay: (programDayId: string) => void;
  /** Wired by `assignment`. See `BuilderActionBar` for why it is optional here. */
  onPublish?: (() => void) | undefined;
}

export function ProgramBuilderScreen({
  programId,
  onBack,
  onOpenDay,
  onPublish,
}: ProgramBuilderScreenProps) {
  const theme = useTheme();
  const themed = useThemedStyles();
  const insets = useSafeAreaInsets();

  const { program, updateProgram, addWeek, addDay } = useProgramBuilder(programId);

  const [collapsedWeekIds, setCollapsedWeekIds] = useState<ReadonlySet<string>>(new Set());
  const [isDetailsOpen, setDetailsOpen] = useState(false);
  const [addDayWeek, setAddDayWeek] = useState<ProgramWeek | null>(null);
  const [lengthError, setLengthError] = useState<string | undefined>(undefined);

  const data = program.data;

  const detailValues = useMemo(
    () =>
      data
        ? {
            name: data.name,
            description: data.description ?? '',
            durationWeeks: data.durationWeeks,
          }
        : undefined,
    [data],
  );

  if (program.isPending) {
    return (
      <View style={[styles.flex, themed.screen, { paddingTop: insets.top + spacing(6) }]}>
        <View style={styles.gutter}>
          <LoadingState shape="list" rows={4} accessibilityLabel="Loading this program" />
        </View>
      </View>
    );
  }

  if (program.isError) {
    const code = getErrorCode(program.error);
    // `ownsResource` answers another coach's program with NOT_FOUND, on
    // purpose — a distinct 403 would confirm the row exists (`ERRORS.md`
    // ER§2.1). A genuine 404 and a foreign id therefore render the same
    // screen, which is the point rather than a shortcut.
    if (code === 'NOT_YOUR_CLIENT') {
      return (
        <View style={[styles.flex, themed.screen, { paddingTop: insets.top + spacing(6) }]}>
          <NotFoundState onRecover={onBack} density="coach" testID="program-not-found" />
        </View>
      );
    }
    if (code === 'ROLE_REQUIRED' || code === 'FEATURE_NOT_IN_TIER') {
      return (
        <View style={[styles.flex, themed.screen, { paddingTop: insets.top + spacing(6) }]}>
          <ForbiddenState onRecover={onBack} density="coach" testID="program-forbidden" />
        </View>
      );
    }
    return (
      <View style={[styles.flex, themed.screen, { paddingTop: insets.top + spacing(6) }]}>
        <View style={styles.gutter}>
          <EmptyState
            // Never an adherence colour for a failed fetch (`DESIGN.md` §8) —
            // the copy carries the meaning, the glyph only draws the eye.
            icon={<TriangleAlert size={22} color={theme.colors.brand.mid} />}
            title="We couldn't load this program"
            body="Check your connection and try again. Nothing you have built is affected."
            primaryAction={{
              label: 'Try again',
              onPress: () => {
                void program.refetch();
              },
            }}
            density="coach"
            testID="program-error"
          />
        </View>
      </View>
    );
  }

  if (!data) return null;

  const weeks = data.weeks;
  const canAddWeek = !addWeek.isPending;

  return (
    <View style={[styles.flex, themed.screen]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: insets.top + spacing(6),
            // Clears the floating action bar rather than sliding under it.
            paddingBottom: insets.bottom + ACTION_BAR_BOTTOM + spacing(64),
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topbar}>
          <IconButton
            icon={<ChevronLeft size={17} color={theme.colors.fg.DEFAULT} />}
            variant="secondary"
            size="sm"
            onPress={onBack}
            accessibilityLabel="Back"
            testID="program-back"
          />
          <View style={styles.grow}>
            <Text size="eyebrow" tone="muted" numberOfLines={1}>
              {`${data.durationWeeks} ${data.durationWeeks === 1 ? 'week' : 'weeks'}`}
            </Text>
            <Text size="h2" numberOfLines={2}>
              {data.name}
            </Text>
          </View>
          {/* `is_template` is DB§5.2's "in the coach's library, not assigned
              to anyone" — the same fact the action bar states in words. */}
          {data.isTemplate ? <Badge tone="neutral" size="sm" label="Draft" /> : null}
          {/* The kebab's slot in frame 1a. A menu whose actions all land in
              task 06 would be an affordance that opens nothing today, so the
              slot carries the one action that works now. */}
          <IconButton
            icon={<SlidersHorizontal size={16} color={theme.colors.fg.muted} />}
            variant="ghost"
            size="sm"
            onPress={() => {
              setLengthError(undefined);
              setDetailsOpen(true);
            }}
            accessibilityLabel="Program details"
            testID="open-program-details"
          />
        </View>

        {weeks.length === 0 ? (
          <EmptyState
            icon={<CalendarPlus size={22} color={theme.colors.brand.DEFAULT} />}
            title="No weeks yet"
            body="A program is built a week at a time. Add the first one and fill in its days."
            primaryAction={{
              label: 'Add week',
              onPress: () => {
                addWeek.mutate({ programId });
              },
            }}
            density="coach"
            testID="program-empty"
          />
        ) : (
          <>
            <Text size="eyebrow" tone="muted">
              Weeks
            </Text>
            {weeks.map((week) => (
              <WeekCard
                key={week.id}
                week={week}
                isExpanded={!collapsedWeekIds.has(week.id)}
                onToggle={() => {
                  setCollapsedWeekIds((current) => {
                    const next = new Set(current);
                    if (next.has(week.id)) next.delete(week.id);
                    else next.add(week.id);
                    return next;
                  });
                }}
                onOpenDay={onOpenDay}
                onAddDay={() => {
                  setAddDayWeek(week);
                }}
                testID={`week-card-${week.weekNumber}`}
              />
            ))}

            <Pressable
              onPress={() => {
                addWeek.mutate({ programId });
              }}
              disabled={!canAddWeek}
              accessibilityRole="button"
              accessibilityLabel="Add week"
              accessibilityState={{ disabled: !canAddWeek }}
              style={[styles.addWeek, themed.ghostBorder]}
              testID="add-week"
            >
              <Plus size={16} color={theme.colors.brand.DEFAULT} />
              <Text size="body-sm" tone="warm">
                Add week
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      <BuilderActionBar
        // No client is attached to a template, so the line states that fact
        // rather than naming a person until `assignment` supplies one.
        statusText="Draft · no client can see this yet"
        {...(onPublish ? { onPublish } : {})}
        publishHint="Assign this program to a client first"
        testID="program-action-bar"
      />

      {/* Mounted only while open, so the sheet's draft is seeded by its own
          `useState` initialiser rather than by an effect (`ecc:react-patterns`
          — a reset effect is a cascading render). */}
      {isDetailsOpen ? (
        <ProgramDetailsSheet
          isOpen
          mode="edit"
          initialValues={detailValues}
          isSaving={updateProgram.isPending}
          lengthError={lengthError}
          onDismiss={() => {
            setDetailsOpen(false);
          }}
          onSave={(values) => {
            setLengthError(undefined);
            updateProgram.mutate(
              {
                programId,
                name: values.name,
                description: values.description.length > 0 ? values.description : null,
                durationWeeks: values.durationWeeks,
              },
              {
                onSuccess: () => {
                  setDetailsOpen(false);
                },
                onError: (error) => {
                  // `PROGRAM_DURATION_TOO_SHORT` belongs under the stepper it
                  // refers to, not in a toast the coach then has to trace back
                  // to a field (`ERRORS.md` ER§0.2 — inline).
                  if (getErrorCode(error) === 'PROGRAM_DURATION_TOO_SHORT') {
                    setLengthError('This program already has more weeks than that.');
                  }
                },
              },
            );
          }}
        />
      ) : null}

      {addDayWeek ? (
        <AddDaySheet
          isOpen
          weekNumber={addDayWeek.weekNumber}
          takenDays={addDayWeek.days}
          isSaving={addDay.isPending}
          onDismiss={() => {
            setAddDayWeek(null);
          }}
          onAdd={(values) => {
            addDay.mutate(
              { programWeekId: addDayWeek.id, ...values },
              {
                onSuccess: () => {
                  setAddDayWeek(null);
                },
              },
            );
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  gutter: { paddingHorizontal: GUTTER },
  scroll: { paddingHorizontal: GUTTER, gap: spacing(8) },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(12),
    paddingBottom: spacing(12),
  },
  addWeek: {
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
