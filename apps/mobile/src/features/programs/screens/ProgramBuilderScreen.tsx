import type { AppErrorCode } from '@coachos/schemas';
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
  useToast,
  useUndoToast,
} from '@coachos/ui';
import {
  CalendarPlus,
  ChevronLeft,
  Copy,
  CopyPlus,
  Plus,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getErrorCode } from '../../../lib/error-code.ts';
import type { ProgramDay, ProgramWeek } from '../api/programs.ts';
import { AddDaySheet } from '../components/AddDaySheet.tsx';
import { AssignProgramSheet } from '../components/AssignProgramSheet.tsx';
import { ACTION_BAR_BOTTOM, BuilderActionBar } from '../components/BuilderActionBar.tsx';
import {
  BuilderActionsMenu,
  useDestructiveInk,
  type BuilderMenuAction,
} from '../components/BuilderActionsMenu.tsx';
import { CopySheet, type CopySubject } from '../components/CopySheet.tsx';
import { ProgramDetailsSheet } from '../components/ProgramDetailsSheet.tsx';
import { WeekCard } from '../components/WeekCard.tsx';
import { nextFreeWeekNumber } from '../duplication.ts';
import { useProgramBuilder } from '../hooks/useProgramBuilder.ts';
import { dayFullLabel } from '../program-days.ts';

// `(coach)/program/[id]` — the builder (`program-builder/01`, frame 1a).
// Coach density throughout: 16px gutter, 56px rows, 46px buttons.
//
// One query, no waterfall (`UI-UX.md` §UX3): `programs.get` returns the
// whole program → weeks → days hierarchy, so the screen has exactly one
// loading state and one error boundary rather than one per level.

const GUTTER = density.coach.gutter;

/** What a kebab was pressed on. A day carries its week too — frame 1g's
 *  middle item duplicates the week the day sits in. */
type MenuSubject =
  { kind: 'week'; week: ProgramWeek } | { kind: 'day'; week: ProgramWeek; day: ProgramDay };

export interface ProgramBuilderScreenProps {
  programId: string;
  onBack: () => void;
  onOpenDay: (programDayId: string) => void;
  /**
   * `assignment/01` — the assign sheet's picker is self-contained (it owns
   * its own client-roster query and its create/pause/complete mutations),
   * but its empty-state action still needs somewhere to navigate, and
   * navigation is the route's job, not a screen's (`code-conventions` §1).
   */
  onInviteClient: () => void;
}

export function ProgramBuilderScreen({
  programId,
  onBack,
  onOpenDay,
  onInviteClient,
}: ProgramBuilderScreenProps) {
  const theme = useTheme();
  const themed = useThemedStyles();
  const insets = useSafeAreaInsets();

  const showUndoToast = useUndoToast();
  const { showToast } = useToast();
  const destructiveInk = useDestructiveInk();

  const {
    program,
    updateProgram,
    addWeek,
    removeWeek,
    addDay,
    removeDay,
    duplicateDay,
    duplicateWeek,
  } = useProgramBuilder(programId);

  const [collapsedWeekIds, setCollapsedWeekIds] = useState<ReadonlySet<string>>(new Set());
  const [isDetailsOpen, setDetailsOpen] = useState(false);
  const [addDayWeek, setAddDayWeek] = useState<ProgramWeek | null>(null);
  const [lengthError, setLengthError] = useState<string | undefined>(undefined);
  // The kebab's contents, and what they are about — one piece of state, so
  // "a menu is open" and "which row it belongs to" cannot disagree.
  const [menuSubject, setMenuSubject] = useState<MenuSubject | null>(null);
  const [copySubject, setCopySubject] = useState<CopySubject | null>(null);
  const [copyErrorCode, setCopyErrorCode] = useState<AppErrorCode | null>(null);
  // Weeks and days the coach has deleted but whose delete has not been sent
  // yet — the undo window is local, so the row leaves the list immediately
  // and comes back if they take it back (`useUndoToast`'s deferred commit).
  const [pendingWeekIds, setPendingWeekIds] = useState<ReadonlySet<string>>(new Set());
  const [pendingDayIds, setPendingDayIds] = useState<ReadonlySet<string>>(new Set());
  // `assignment/01` — "Publish" is assignment. The sheet is self-contained
  // (see its own file comment); this screen owns only whether it's open.
  const [isAssignOpen, setAssignOpen] = useState(false);

  const data = program.data;

  const detailValues = useMemo(
    () =>
      data
        ? {
            name: data.name,
            description: data.description ?? '',
            durationWeeks: data.durationWeeks,
            isTemplate: data.isTemplate,
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

  // A deleted week or day is gone from the list the moment it is deleted,
  // and back the moment Undo is tapped — the server has not been told yet
  // either way.
  const weeks = data.weeks
    .filter((week) => !pendingWeekIds.has(week.id))
    .map((week) => ({ ...week, days: week.days.filter((day) => !pendingDayIds.has(day.id)) }));
  const canAddWeek = !addWeek.isPending;
  const targetWeekNumber = nextFreeWeekNumber(weeks);

  function deleteWeek(week: ProgramWeek): void {
    setPendingWeekIds((current) => new Set(current).add(week.id));
    showUndoToast({
      message: `Week ${String(week.weekNumber)} deleted`,
      onUndo: () => {
        setPendingWeekIds((current) => {
          const next = new Set(current);
          next.delete(week.id);
          return next;
        });
      },
      onCommit: () => {
        removeWeek.mutate({ programWeekId: week.id });
      },
    });
  }

  function deleteDay(day: ProgramDay): void {
    setPendingDayIds((current) => new Set(current).add(day.id));
    showUndoToast({
      message: `${day.name} deleted`,
      onUndo: () => {
        setPendingDayIds((current) => {
          const next = new Set(current);
          next.delete(day.id);
          return next;
        });
      },
      onCommit: () => {
        removeDay.mutate({ programDayId: day.id });
      },
    });
  }

  function openCopy(subject: CopySubject): void {
    setMenuSubject(null);
    setCopyErrorCode(null);
    setCopySubject(subject);
  }

  // Frame 1g's three items on a day, and the week's own two on a week
  // header. Destructive last, after a divider, in the urgent ramp.
  function menuActions(subject: MenuSubject): BuilderMenuAction[] {
    const copyIcon = <Copy size={16} color={theme.colors.fg.DEFAULT} />;
    const weekIcon = <CopyPlus size={16} color={theme.colors.fg.DEFAULT} />;
    const deleteIcon = <Trash2 size={16} color={destructiveInk} />;

    if (subject.kind === 'week') {
      return [
        {
          actionId: 'duplicate-week',
          label: 'Duplicate whole week',
          icon: weekIcon,
          onPress: () => {
            openCopy({ kind: 'week', week: subject.week });
          },
        },
        {
          actionId: 'delete-week',
          label: 'Delete week',
          icon: deleteIcon,
          isDestructive: true,
          onPress: () => {
            setMenuSubject(null);
            deleteWeek(subject.week);
          },
        },
      ];
    }
    return [
      {
        actionId: 'duplicate-day',
        label: 'Duplicate this day',
        icon: copyIcon,
        onPress: () => {
          openCopy({ kind: 'day', day: subject.day, sourceWeekNumber: subject.week.weekNumber });
        },
      },
      {
        actionId: 'duplicate-week',
        label: 'Duplicate whole week',
        icon: weekIcon,
        onPress: () => {
          openCopy({ kind: 'week', week: subject.week });
        },
      },
      {
        actionId: 'delete-day',
        label: 'Delete day',
        icon: deleteIcon,
        isDestructive: true,
        onPress: () => {
          setMenuSubject(null);
          deleteDay(subject.day);
        },
      },
    ];
  }

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
          {/* Frame 1a's topbar control. It stays a direct route to the
              program's own details rather than becoming a third menu:
              duplicate and delete are about a WEEK or a DAY, and both now
              hang off the kebab on the row they are about (frame 1g). */}
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
                onWeekMenu={() => {
                  setMenuSubject({ kind: 'week', week });
                }}
                onDayMenu={(day) => {
                  setMenuSubject({ kind: 'day', week, day });
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
        // rather than naming a person until the coach actually assigns it.
        statusText="Draft · no client can see this yet"
        onPublish={() => {
          setAssignOpen(true);
        }}
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
                isTemplate: values.isTemplate,
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

      {menuSubject ? (
        <BuilderActionsMenu
          isOpen
          title={
            menuSubject.kind === 'week'
              ? `Week ${String(menuSubject.week.weekNumber)}`
              : dayFullLabel(menuSubject.day.dayNumber)
          }
          subtitle={menuSubject.kind === 'week' ? undefined : menuSubject.day.name}
          actions={menuActions(menuSubject)}
          onDismiss={() => {
            setMenuSubject(null);
          }}
        />
      ) : null}

      {copySubject ? (
        <CopySheet
          isOpen
          subject={copySubject}
          weeks={weeks}
          targetWeekNumber={targetWeekNumber}
          isSaving={duplicateDay.isPending || duplicateWeek.isPending}
          errorCode={copyErrorCode}
          onDismiss={() => {
            setCopySubject(null);
            setCopyErrorCode(null);
          }}
          onCopy={(commit) => {
            setCopyErrorCode(null);
            if (commit.kind === 'week') {
              if (copySubject.kind !== 'week' || targetWeekNumber === null) return;
              duplicateWeek.mutate(
                { sourceWeekId: copySubject.week.id },
                {
                  onSuccess: (result) => {
                    setCopySubject(null);
                    // States the fact, and where to find it — a copy that
                    // lands off-screen with no word is indistinguishable
                    // from one that failed (`COPY.md` CO§4.3).
                    showToast({
                      message: `Week ${String(copySubject.week.weekNumber)} copied to week ${String(result.weekNumber)}`,
                    });
                  },
                  onError: (error) => {
                    setCopyErrorCode(getErrorCode(error));
                  },
                },
              );
              return;
            }
            if (copySubject.kind !== 'day') return;
            duplicateDay.mutate(
              {
                sourceDayId: copySubject.day.id,
                targetWeekId: commit.targetWeekId,
                targetDayNumber: commit.targetDayNumber,
              },
              {
                onSuccess: () => {
                  setCopySubject(null);
                  showToast({
                    message: `${copySubject.day.name} copied to ${dayFullLabel(commit.targetDayNumber)}`,
                  });
                },
                // The refusal belongs in the sheet, under the slots it is
                // about, not in a toast the coach has to trace back to a
                // control (`ERRORS.md` ER§0.2 — inline).
                onError: (error) => {
                  setCopyErrorCode(getErrorCode(error));
                },
              },
            );
          }}
        />
      ) : null}

      {isAssignOpen ? (
        <AssignProgramSheet
          isOpen
          mode="single"
          programId={programId}
          programName={data.name}
          durationWeeks={data.durationWeeks}
          onDismiss={() => {
            setAssignOpen(false);
          }}
          onAssigned={() => {
            setAssignOpen(false);
            showToast({ message: 'Program assigned' });
          }}
          onInviteClient={() => {
            setAssignOpen(false);
            onInviteClient();
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
