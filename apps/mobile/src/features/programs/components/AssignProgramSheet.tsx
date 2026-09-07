import type { CalendarDate as WireCalendarDate } from '@coachos/schemas';
import {
  Avatar,
  Button,
  Calendar,
  Card,
  createThemedStyles,
  EmptyState,
  Input,
  LoadingState,
  Pressable,
  radius,
  Sheet,
  SheetFooter,
  SheetHeader,
  spacing,
  tapTarget,
  Text,
  useTheme,
} from '@coachos/ui';
import type { CalendarDate } from '@coachos/utils';
import { CalendarDays, ChevronDown, ChevronRight, TriangleAlert, Users } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { asUuid, trackEvent } from '../../../lib/analytics/index.ts';
import { getErrorCode, getErrorDetails } from '../../../lib/error-code.ts';
import { api } from '../../../lib/trpc.ts';
import {
  useAssignableClients,
  useCompleteAssignment,
  useCreateAssignment,
  usePauseAssignment,
  type AssignableClient,
} from '../api/assignments.ts';

// The assign sheet (`assignment/01`, frames A/B/E). Single-client mode
// only — `mode` is accepted now, not branched on, so `assignment/02`'s
// bulk multi-select mode extends this component rather than restructuring
// it.
//
// **Self-contained, unlike `CopySheet`/`ProgramDetailsSheet`.** Those two
// are controlled: the host screen owns the mutation and hands down
// `isSaving`/`errorCode`/`onCopy`. This sheet owns its own queries and
// mutations instead — the client roster and the pause/complete resolution
// are not data `ProgramBuilderScreen` (or any other host) already holds
// for its own purposes, so there is nothing for a host to usefully own on
// this one's behalf. The host's whole job is opening and closing it.

export type AssignProgramSheetMode = 'single';

export interface AssignProgramSheetInitialClient {
  clientId: string;
  name: string;
}

export interface AssignProgramSheetProps {
  isOpen: boolean;
  mode: AssignProgramSheetMode;
  programId: string;
  programName: string;
  durationWeeks: number;
  /**
   * Set when the sheet is opened from that client's own detail screen —
   * the client row becomes inert text rather than a picker trigger
   * (design spec, Client section).
   */
  initialClient?: AssignProgramSheetInitialClient | undefined;
  onDismiss: () => void;
  onAssigned: (assignment: { id: string; clientId: string }) => void;
  /** The picker's empty-state action, when the coach has no assignable clients at all. */
  onInviteClient: () => void;
}

interface ConflictPayload {
  assignmentId: string;
  programName: string;
  currentWeek: number;
  durationWeeks: number;
}

function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** Today, in this device's own local calendar day — an explicit date the
 * coach is about to pick, not a stored day-boundary inference, so
 * `code-conventions` §6's per-user-timezone rule doesn't bind this default
 * the way it binds a logged event. */
function todayCalendarDate(): CalendarDate {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}` as CalendarDate;
}

/** "Today · Weekday, D Mon" for today, "Weekday, D Mon" otherwise — a fixed
 * template (design spec), not the device locale's own field order. */
function formatStartDateLabel(date: CalendarDate, today: CalendarDate): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const parsed = new Date(year, month - 1, day);
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(parsed);
  const monthShort = new Intl.DateTimeFormat(undefined, { month: 'short' }).format(parsed);
  const formatted = `${weekday}, ${String(parsed.getDate())} ${monthShort}`;
  return date === today ? `Today · ${formatted}` : formatted;
}

/**
 * Bridges `@coachos/utils`'s plain-string `CalendarDate` — what `<Calendar>`
 * and this sheet's own draft state use — to `packages/schemas`' branded
 * `calendarDate` output, which `assignments.create`'s input requires. Same
 * runtime value, same `"yyyy-MM-dd"` shape; the brand is a compile-time-only
 * marker with nothing for this cast to actually validate.
 */
function toWireDate(date: CalendarDate): WireCalendarDate {
  return date as WireCalendarDate;
}

function statusTextFor(client: Pick<AssignableClient, 'activeAssignment'> | null): string {
  if (!client?.activeAssignment) return 'No active program';
  return `On ${client.activeAssignment.programName}`;
}

export function AssignProgramSheet({
  isOpen,
  // `mode` isn't destructured — `'single'` is this task's only value, and
  // there is nothing to branch on yet. `assignment/02` is what gives it a
  // second value and a reason to read it.
  programId,
  programName,
  durationWeeks,
  initialClient,
  onDismiss,
  onAssigned,
  onInviteClient,
}: AssignProgramSheetProps) {
  const theme = useTheme();
  const themed = useThemedStyles();
  const utils = api.useUtils();

  const clientsQuery = useAssignableClients();
  const createAssignment = useCreateAssignment();
  const pauseAssignment = usePauseAssignment();
  const completeAssignment = useCompleteAssignment();

  const [pickedClientId, setPickedClientId] = useState<string | null>(null);
  const [isPickerOpen, setPickerOpen] = useState(false);
  const [startDate, setStartDate] = useState<CalendarDate>(todayCalendarDate);
  const [isCalendarOpen, setCalendarOpen] = useState(false);
  const [resolution, setResolution] = useState<'pause' | 'complete' | null>(null);
  const [conflictOverride, setConflictOverride] = useState<ConflictPayload | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const clients = clientsQuery.data?.items ?? [];
  const clientId = initialClient?.clientId ?? pickedClientId;
  const selectedClient = clients.find((client) => client.id === clientId) ?? null;
  const displayName = selectedClient?.name ?? initialClient?.name ?? '';
  const firstName = firstNameOf(displayName);
  const statusText = statusTextFor(selectedClient);

  // No `useMemo` — this is a cheap object construction, not a measured
  // problem (`code-conventions` §4: memoise only after profiling shows one).
  const derivedConflict: ConflictPayload | null = selectedClient?.activeAssignment
    ? {
        assignmentId: selectedClient.activeAssignment.id,
        programName: selectedClient.activeAssignment.programName,
        currentWeek: selectedClient.activeAssignment.currentWeek,
        durationWeeks: selectedClient.activeAssignment.durationWeeks,
      }
    : null;

  const conflictSource = conflictOverride ?? derivedConflict;
  const conflict = resolution === null ? conflictSource : null;
  // The card's own presence outlives the conflict data it was built from —
  // once `resolution` is set, `pauseAssignment`'s `onSuccess` has already
  // invalidated the roster query, and a real refetch (unlike this file's
  // mock) will eventually clear `conflictSource` entirely. Gating
  // visibility on `conflict` alone would make the "Paused — you can assign
  // now." confirmation vanish the moment that refetch lands, rather than
  // staying up until the coach picks a different client.
  const showConflictCard = conflictSource !== null || resolution !== null;
  const today = todayCalendarDate();

  function selectClient(client: AssignableClient): void {
    setPickedClientId(client.id);
    setConflictOverride(null);
    setResolution(null);
    setInlineError(null);
    setPickerOpen(false);
  }

  function handleSubmit(): void {
    if (clientId === null) return;
    setInlineError(null);
    createAssignment.mutate(
      { programId, clientId, startDate: toWireDate(startDate) },
      {
        onSuccess: (result) => {
          trackEvent('program_assigned', {
            client_id: asUuid(clientId),
            program_id: asUuid(programId),
            week_count: durationWeeks,
          });
          onAssigned({ id: result.id, clientId });
        },
        onError: (error) => {
          if (getErrorCode(error) === 'CLIENT_ALREADY_HAS_ACTIVE_ASSIGNMENT') {
            const details = getErrorDetails(error, 'CLIENT_ALREADY_HAS_ACTIVE_ASSIGNMENT');
            if (details) setConflictOverride(details);
            return;
          }
          setInlineError("That didn't save. Check your connection and try again.");
        },
      },
    );
  }

  function handlePause(assignmentId: string): void {
    setInlineError(null);
    pauseAssignment.mutate(
      { assignmentId },
      {
        onSuccess: () => {
          setResolution('pause');
          void utils.assignments.assignableClients.invalidate();
        },
        onError: () => {
          setInlineError("That didn't save. Check your connection and try again.");
        },
      },
    );
  }

  function handleComplete(assignmentId: string): void {
    setInlineError(null);
    completeAssignment.mutate(
      { assignmentId },
      {
        onSuccess: () => {
          setResolution('complete');
          void utils.assignments.assignableClients.invalidate();
        },
        onError: () => {
          setInlineError("That didn't save. Check your connection and try again.");
        },
      },
    );
  }

  const isResolvingConflict = pauseAssignment.isPending || completeAssignment.isPending;
  const canSubmit = clientId !== null && conflict === null && !createAssignment.isPending;

  let footerLabel: string;
  if (clientId === null) {
    footerLabel = 'Choose a client';
  } else if (createAssignment.isPending) {
    footerLabel = 'Assigning…';
  } else if (conflict !== null) {
    footerLabel = 'Pause or complete first';
  } else {
    footerLabel = `Assign to ${firstName}`;
  }

  return (
    <>
      {/* Unmounted, not merely covered, while the picker is open — two
          simultaneously-open `<Sheet>`s each set `accessibilityViewIsModal`
          (`packages/ui`'s own contract), and RN accessibility treats every
          OTHER modal-flagged sibling's subtree as hidden, in both
          directions, the moment there are two. One sheet showing at a time
          keeps this sheet's own row/footer reachable by a screen reader
          the instant the picker closes, rather than silently inert behind
          it. */}
      <Sheet
        isOpen={isOpen && !isPickerOpen}
        onDismiss={onDismiss}
        snap="auto"
        testID="assign-program-sheet"
      >
        <SheetHeader
          title="Assign program"
          subtitle={`${programName} · ${String(durationWeeks)} ${durationWeeks === 1 ? 'week' : 'weeks'}`}
          onClose={onDismiss}
          density="coach"
        />
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.field}>
            <Text size="eyebrow" tone="warm-muted">
              Client
            </Text>
            {initialClient ? (
              <View
                accessible
                accessibilityRole="text"
                accessibilityLabel={`Client, ${firstName}, ${statusText.toLowerCase()}`}
                style={[styles.clientRow, { minHeight: tapTarget.MIN }]}
                testID="assign-client-row"
              >
                <Avatar size="sm" name={displayName} userId={initialClient.clientId} />
                <View style={styles.grow}>
                  <Text size="label" numberOfLines={1}>
                    {displayName}
                  </Text>
                  <Text size="micro" tone="muted" numberOfLines={1}>
                    {statusText}
                  </Text>
                </View>
              </View>
            ) : (
              <Pressable
                onPress={() => {
                  setPickerOpen(true);
                }}
                accessibilityRole="button"
                accessibilityLabel={
                  selectedClient
                    ? `Client, ${firstName}, ${statusText.toLowerCase()}`
                    : 'Choose a client'
                }
                style={[styles.clientRow, { minHeight: tapTarget.MIN }]}
                testID="assign-client-row"
              >
                {selectedClient ? (
                  <>
                    <Avatar size="sm" name={displayName} userId={selectedClient.id} />
                    <View style={styles.grow}>
                      <Text size="label" numberOfLines={1}>
                        {displayName}
                      </Text>
                      <Text size="micro" tone="muted" numberOfLines={1}>
                        {statusText}
                      </Text>
                    </View>
                  </>
                ) : (
                  <Text size="label" tone="muted" style={styles.grow}>
                    Choose a client
                  </Text>
                )}
                <ChevronRight size={16} color={theme.colors.fg.subtle} />
              </Pressable>
            )}
            {initialClient ? (
              <Text size="caption" tone="subtle" testID="assign-scoped-note">
                {`Opened from ${firstName}'s profile, so the client is set.`}
              </Text>
            ) : null}
          </View>

          {showConflictCard ? (
            <Card elevation="tinted" density="coach" testID="assign-conflict-card">
              <View style={styles.conflictContent}>
                <View style={styles.conflictHeader}>
                  <TriangleAlert size={18} color={theme.colors.fg.warm} />
                  <Text size="label" style={styles.grow} accessibilityRole="alert">
                    Already on a program
                  </Text>
                </View>
                {conflict ? (
                  <>
                    <Text size="body-sm" tone="muted">
                      {`${firstName} is on ${conflict.programName}, week ${String(conflict.currentWeek)} of ${String(conflict.durationWeeks)}. Pause or mark it complete to start this one instead.`}
                    </Text>
                    <View style={styles.conflictActions}>
                      <Button
                        variant="secondary"
                        size="sm"
                        density="coach"
                        onPress={() => {
                          handlePause(conflict.assignmentId);
                        }}
                        disabled={isResolvingConflict}
                        loading={pauseAssignment.isPending}
                        accessibilityLabel={`Pause ${firstName}'s current program`}
                        testID="assign-conflict-pause"
                      >
                        Pause current program
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        density="coach"
                        onPress={() => {
                          handleComplete(conflict.assignmentId);
                        }}
                        disabled={isResolvingConflict}
                        loading={completeAssignment.isPending}
                        accessibilityLabel={`Mark ${firstName}'s current program as complete`}
                        testID="assign-conflict-complete"
                      >
                        Mark as complete
                      </Button>
                    </View>
                  </>
                ) : resolution ? (
                  <Text size="body-sm" tone="muted" testID="assign-conflict-resolved">
                    {resolution === 'pause'
                      ? 'Paused — you can assign now.'
                      : 'Marked complete — you can assign now.'}
                  </Text>
                ) : null}
              </View>
            </Card>
          ) : null}

          <View style={styles.field}>
            <Text size="eyebrow" tone="warm-muted">
              Start date
            </Text>
            <Pressable
              onPress={() => {
                setCalendarOpen((current) => !current);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Start date, ${formatStartDateLabel(startDate, today)}`}
              accessibilityHint="Opens calendar"
              style={[styles.dateField, themed.dateField, { minHeight: tapTarget.MIN }]}
              testID="assign-start-date"
            >
              <CalendarDays size={16} color={theme.colors.fg.muted} />
              <Text size="body-sm" style={styles.grow}>
                {formatStartDateLabel(startDate, today)}
              </Text>
              <ChevronDown size={16} color={theme.colors.fg.subtle} />
            </Pressable>
            {isCalendarOpen ? (
              <Calendar
                mode="single"
                selected={startDate}
                onSelect={(date) => {
                  setStartDate(date);
                  setCalendarOpen(false);
                }}
                today={today}
                density="coach"
                testID="assign-calendar"
              />
            ) : null}
          </View>

          {inlineError ? (
            <Text size="body-sm" tone="urgent" accessibilityRole="alert" testID="assign-error">
              {inlineError}
            </Text>
          ) : null}
        </ScrollView>
        <SheetFooter
          actionLabel={footerLabel}
          onAction={handleSubmit}
          isActionDisabled={!canSubmit}
          isActionLoading={createAssignment.isPending}
          density="coach"
        />
      </Sheet>

      {isPickerOpen ? (
        <ClientPickerSheet
          isOpen
          clients={clients}
          isLoading={clientsQuery.isPending}
          isError={clientsQuery.isError}
          onRetry={() => {
            void clientsQuery.refetch();
          }}
          onSelect={selectClient}
          onDismiss={() => {
            setPickerOpen(false);
          }}
          onInviteClient={onInviteClient}
        />
      ) : null}
    </>
  );
}

interface ClientPickerSheetProps {
  isOpen: boolean;
  clients: readonly AssignableClient[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onSelect: (client: AssignableClient) => void;
  onDismiss: () => void;
  onInviteClient: () => void;
}

function ClientPickerSheet({
  isOpen,
  clients,
  isLoading,
  isError,
  onRetry,
  onSelect,
  onDismiss,
  onInviteClient,
}: ClientPickerSheetProps) {
  const theme = useTheme();
  const [query, setQuery] = useState('');

  const filtered =
    query.trim().length === 0
      ? clients
      : clients.filter((client) => client.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <Sheet isOpen={isOpen} onDismiss={onDismiss} snap="auto" testID="assign-client-picker">
      <SheetHeader title="Choose a client" onClose={onDismiss} density="coach" />
      <View style={styles.pickerSearch}>
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Search clients"
          accessibilityLabel="Search clients"
          density="coach"
          testID="assign-client-search"
        />
      </View>
      <ScrollView
        contentContainerStyle={styles.pickerBody}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <LoadingState shape="list" rows={4} accessibilityLabel="Loading your clients" />
        ) : isError ? (
          <EmptyState
            icon={<TriangleAlert size={22} color={theme.colors.brand.mid} />}
            title="We couldn't load your clients"
            body="Check your connection and try again."
            primaryAction={{ label: 'Try again', onPress: onRetry }}
            density="coach"
            testID="assign-client-picker-error"
          />
        ) : clients.length === 0 ? (
          <EmptyState
            icon={<Users size={22} color={theme.colors.fg.muted} />}
            title="No clients yet"
            body="You need at least one client before you can assign a program."
            primaryAction={{ label: 'Invite a client', onPress: onInviteClient }}
            density="coach"
            testID="assign-client-picker-empty"
          />
        ) : (
          filtered.map((client) => (
            <Pressable
              key={client.id}
              onPress={() => {
                onSelect(client);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${client.name}, ${statusTextFor(client).toLowerCase()}`}
              style={[styles.pickerRow, { minHeight: tapTarget.MIN }]}
              testID={`assign-client-option-${client.id}`}
            >
              <Avatar size="sm" name={client.name} userId={client.id} />
              <View style={styles.grow}>
                <Text size="label" numberOfLines={1}>
                  {client.name}
                </Text>
                <Text size="micro" tone="muted" numberOfLines={1}>
                  {statusTextFor(client)}
                </Text>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing(14), paddingTop: spacing(12), gap: spacing(14) },
  grow: { flex: 1, minWidth: 0 },
  field: { gap: spacing(8) },
  clientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(11),
  },
  conflictContent: { gap: spacing(9) },
  conflictHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(8),
  },
  conflictActions: {
    flexDirection: 'row',
    gap: spacing(9),
  },
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(9),
    paddingHorizontal: spacing(12),
    borderRadius: radius.control,
  },
  pickerSearch: { paddingHorizontal: spacing(14), paddingTop: spacing(8) },
  pickerBody: {
    paddingHorizontal: spacing(14),
    paddingTop: spacing(10),
    paddingBottom: spacing(24),
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(12),
    paddingVertical: spacing(6),
  },
});

const useThemedStyles = createThemedStyles((t) => ({
  dateField: {
    backgroundColor: t.colors.bg.inset,
    borderWidth: 1,
    borderColor: t.colors.border.soft,
  },
}));
