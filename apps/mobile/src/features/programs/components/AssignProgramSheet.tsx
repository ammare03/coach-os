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
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  TriangleAlert,
  Users,
} from 'lucide-react-native';
import { useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, View } from 'react-native';

import { asUuid, trackEvent } from '../../../lib/analytics/index.ts';
import { getErrorCode, getErrorDetails } from '../../../lib/error-code.ts';
import { api } from '../../../lib/trpc.ts';
import {
  useAssignableClients,
  useBulkCreateAssignment,
  useCompleteAssignment,
  useCreateAssignment,
  usePauseAssignment,
  type AssignableClient,
} from '../api/assignments.ts';
import { firstNameOf } from '../mid-session.ts';

// The assign sheet. `assignment/01` built single-client mode (frames A/B/E);
// `assignment/02` adds bulk mode (frames C/D) as a hard branch on `mode`,
// never a toggle the coach flips inside the sheet (the approved design's
// own note on frame C) — the two mode bodies below are rendered by ONE
// exported component so a consumer never imports two different sheets for
// what is, from the outside, one feature.
//
// **Self-contained, unlike `CopySheet`/`ProgramDetailsSheet`.** Those two
// are controlled: the host screen owns the mutation and hands down
// `isSaving`/`errorCode`/`onCopy`. This sheet owns its own queries and
// mutations instead — the client roster and the pause/complete resolution
// are not data `ProgramBuilderScreen` (or any other host) already holds
// for its own purposes, so there is nothing for a host to usefully own on
// this one's behalf. The host's whole job is opening and closing it.

export type AssignProgramSheetMode = 'single' | 'bulk';

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
   * (design spec, Client section). Single mode only; bulk mode ignores it.
   */
  initialClient?: AssignProgramSheetInitialClient | undefined;
  onDismiss: () => void;
  /**
   * Single mode only — fired once, on that one client's successful
   * assignment. Bulk mode never calls this: its own outcome view (frame D)
   * shows every client's result inline and "Done" simply closes the sheet,
   * so a host opening bulk mode still passes a handler (kept required to
   * avoid a second prop shape) but it goes unused.
   */
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

// Moved to `../mid-session.ts` on its second consumer (`code-conventions`
// §1) — the mid-session warning names clients the same way this sheet does.

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

export function AssignProgramSheet(props: AssignProgramSheetProps) {
  if (props.mode === 'bulk') {
    return (
      <BulkAssignSheetBody
        isOpen={props.isOpen}
        programId={props.programId}
        programName={props.programName}
        durationWeeks={props.durationWeeks}
        onDismiss={props.onDismiss}
        onInviteClient={props.onInviteClient}
      />
    );
  }
  return <SingleAssignSheetBody {...props} />;
}

function SingleAssignSheetBody({
  isOpen,
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

// ---------------------------------------------------------------------------
// Bulk mode (`assignment/02`, frames C/D)
// ---------------------------------------------------------------------------

/** The design's `.ck` — 22px of box inside a 56px row, per frame C. Same
 * treatment `ExercisePickerSheet`'s own multi-select checkbox uses (solid
 * brand fill when checked, bordered box when not, a `Check` glyph on top —
 * there is no shared `Checkbox` primitive in `packages/ui`, and this is the
 * second sheet in this codebase to need the exact same 22px-box-in-a-row
 * treatment) — reused rather than hand-rolled a second time, with ONE
 * deliberate difference: `CHECKBOX_RADIUS` below is 6px, a square-ish
 * corner, not `radius.full`'s circle, because frame C's own `.ck` CSS class
 * is `border-radius:6px` and this task's brief is to build to that spec,
 * not invent a new one. 6 isn't on `tokens.ts`'s shared radius ladder
 * (`cell:3, chip:7, control:12…`) — same as the handful of other literal
 * `borderRadius` values already in this codebase's screens for a value the
 * ladder doesn't carry (`GuardianConsentPendingScreen`, for one).
 */
const BULK_CHECKBOX = 22;
const BULK_CHECKBOX_RADIUS = 6;
/** Frame C's `.clientrow{min-height:56px}` — `ui-conventions`' own "never a fixed height" rule, so `minHeight`, not `height`. */
const BULK_ROW_MIN_HEIGHT = 56;

interface BulkSucceededRow {
  clientId: string;
  assignmentId: string;
  name: string;
}

interface BulkConflictedRow {
  clientId: string;
  assignmentId: string;
  name: string;
  programName: string;
  currentWeek: number;
  durationWeeks: number;
}

/**
 * "3 of 4 clients assigned. 1 needs attention." — frame D's own example,
 * verbatim, for the one-conflict case. Said once, on arrival
 * (`AccessibilityInfo.announceForAccessibility`, called exactly once from
 * the mutation's `onSuccess`) — an optimistic outcome view is otherwise
 * invisible to a screen reader. The "needs attention" clause is omitted
 * entirely when nothing conflicted, matching frame D's own "omit the
 * section, never show it empty" rule extended to the announcement.
 */
function outcomeAnnouncement(succeededCount: number, conflictedCount: number): string {
  const total = succeededCount + conflictedCount;
  const base = `${String(succeededCount)} of ${String(total)} ${total === 1 ? 'client' : 'clients'} assigned.`;
  if (conflictedCount === 0) return base;
  const attention = conflictedCount === 1 ? 'needs attention' : 'need attention';
  return `${base} ${String(conflictedCount)} ${attention}.`;
}

interface BulkAssignSheetBodyProps {
  isOpen: boolean;
  programId: string;
  programName: string;
  durationWeeks: number;
  onDismiss: () => void;
  onInviteClient: () => void;
}

function BulkAssignSheetBody({
  isOpen,
  programId,
  programName,
  durationWeeks,
  onDismiss,
  onInviteClient,
}: BulkAssignSheetBodyProps) {
  const theme = useTheme();
  const utils = api.useUtils();
  const clientsQuery = useAssignableClients();
  const bulkCreateAssignment = useBulkCreateAssignment();
  const createAssignment = useCreateAssignment();
  const pauseAssignment = usePauseAssignment();
  const completeAssignment = useCompleteAssignment();

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [startDate, setStartDate] = useState<CalendarDate>(todayCalendarDate);
  const [isCalendarOpen, setCalendarOpen] = useState(false);
  const [stage, setStage] = useState<'picking' | 'outcome'>('picking');
  const [succeeded, setSucceeded] = useState<readonly BulkSucceededRow[]>([]);
  const [conflicted, setConflicted] = useState<readonly BulkConflictedRow[]>([]);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [resolvingClientId, setResolvingClientId] = useState<string | null>(null);
  const [resolvingAction, setResolvingAction] = useState<'pause' | 'complete' | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  // A fresh sheet every time it opens — a selection or an outcome carried
  // over from the last time this sheet was opened would silently apply to
  // a program the coach never chose this time. Adjusted during render
  // against the previous `isOpen`, React's own documented pattern for
  // "reset state when a prop changes" (the same technique
  // `ApprovedSwapsSheet`/`ExercisePickerSheet` use for the same reason).
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setSelectedIds(new Set());
      setQuery('');
      setStartDate(todayCalendarDate());
      setCalendarOpen(false);
      setStage('picking');
      setSucceeded([]);
      setConflicted([]);
      setBulkError(null);
      setResolvingClientId(null);
      setResolvingAction(null);
      setRowError(null);
    }
  }

  const clients = clientsQuery.data?.items ?? [];
  const filtered =
    query.trim().length === 0
      ? clients
      : clients.filter((client) => client.name.toLowerCase().includes(query.trim().toLowerCase()));
  const today = todayCalendarDate();

  function toggleClient(clientId: string): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(clientId)) {
        next.delete(clientId);
      } else {
        next.add(clientId);
      }
      return next;
    });
  }

  function handleBulkSubmit(): void {
    if (selectedIds.size === 0) return;
    setBulkError(null);
    const clientIds = [...selectedIds];
    const byId = new Map(clients.map((client) => [client.id, client]));

    bulkCreateAssignment.mutate(
      { programId, clientIds, startDate: toWireDate(startDate) },
      {
        onSuccess: (result) => {
          const succeededRows: BulkSucceededRow[] = result.succeeded.map((item) => ({
            clientId: item.clientId,
            assignmentId: item.assignmentId,
            name: byId.get(item.clientId)?.name ?? '',
          }));
          const conflictedRows: BulkConflictedRow[] = result.conflicted.map((item) => ({
            clientId: item.clientId,
            assignmentId: item.assignmentId,
            name: byId.get(item.clientId)?.name ?? '',
            programName: item.programName,
            currentWeek: item.currentWeek,
            durationWeeks: item.durationWeeks,
          }));

          for (const row of succeededRows) {
            trackEvent('program_assigned', {
              client_id: asUuid(row.clientId),
              program_id: asUuid(programId),
              week_count: durationWeeks,
            });
          }

          setSucceeded(succeededRows);
          setConflicted(conflictedRows);
          setStage('outcome');
          AccessibilityInfo.announceForAccessibility(
            outcomeAnnouncement(succeededRows.length, conflictedRows.length),
          );
          void utils.assignments.assignableClients.invalidate();
        },
        onError: () => {
          setBulkError("That didn't save. Check your connection and try again.");
        },
      },
    );
  }

  /**
   * Frame D's own rule: resolving Pause/Complete on a conflicted row
   * "immediately retries that one client's assignment" — not just clears
   * the conflict for the coach to resubmit by hand (single mode's own
   * behaviour), because there is no second submit button per row in the
   * outcome view. Success moves the row from `conflicted` into `succeeded`
   * with its real new `assignmentId`.
   */
  function resolveConflict(row: BulkConflictedRow, action: 'pause' | 'complete'): void {
    setRowError(null);
    setResolvingClientId(row.clientId);
    setResolvingAction(action);

    function settle(): void {
      setResolvingClientId(null);
      setResolvingAction(null);
    }

    function retryCreate(): void {
      void utils.assignments.assignableClients.invalidate();
      createAssignment.mutate(
        { programId, clientId: row.clientId, startDate: toWireDate(startDate) },
        {
          onSuccess: (result) => {
            trackEvent('program_assigned', {
              client_id: asUuid(row.clientId),
              program_id: asUuid(programId),
              week_count: durationWeeks,
            });
            setConflicted((current) => current.filter((entry) => entry.clientId !== row.clientId));
            setSucceeded((current) => [
              ...current,
              { clientId: row.clientId, assignmentId: result.id, name: row.name },
            ]);
            settle();
          },
          onError: () => {
            setRowError("That didn't save. Check your connection and try again.");
            settle();
          },
        },
      );
    }

    const mutation = action === 'pause' ? pauseAssignment : completeAssignment;
    mutation.mutate(
      { assignmentId: row.assignmentId },
      {
        onSuccess: retryCreate,
        onError: () => {
          setRowError("That didn't save. Check your connection and try again.");
          settle();
        },
      },
    );
  }

  let footerLabel: string;
  if (selectedIds.size === 0) {
    footerLabel = 'Select clients to assign';
  } else if (bulkCreateAssignment.isPending) {
    footerLabel = 'Assigning…';
  } else if (selectedIds.size === 1) {
    footerLabel = 'Assign to 1 client';
  } else {
    footerLabel = `Assign to ${String(selectedIds.size)} clients`;
  }
  const canSubmit = selectedIds.size > 0 && !bulkCreateAssignment.isPending;

  return (
    <Sheet isOpen={isOpen} onDismiss={onDismiss} snap="full" testID="assign-bulk-sheet">
      {stage === 'outcome' ? (
        <BulkOutcomeView
          programName={programName}
          succeeded={succeeded}
          conflicted={conflicted}
          resolvingClientId={resolvingClientId}
          resolvingAction={resolvingAction}
          isPausePending={pauseAssignment.isPending}
          isCompletePending={completeAssignment.isPending}
          rowError={rowError}
          onResolve={resolveConflict}
          onDone={onDismiss}
        />
      ) : (
        <>
          <SheetHeader
            title="Assign program"
            subtitle={`${programName} · ${String(durationWeeks)} ${durationWeeks === 1 ? 'week' : 'weeks'} · same start date for everyone`}
            onClose={onDismiss}
            density="coach"
          />
          <ScrollView
            contentContainerStyle={styles.bulkBody}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder="Search clients"
              accessibilityLabel="Search clients"
              density="coach"
              testID="assign-bulk-search"
            />

            <Text size="eyebrow" tone="warm-muted">
              {`Clients · ${String(selectedIds.size)} selected`}
            </Text>

            {clientsQuery.isPending ? (
              <LoadingState shape="list" rows={4} accessibilityLabel="Loading your clients" />
            ) : clientsQuery.isError ? (
              <EmptyState
                icon={<TriangleAlert size={22} color={theme.colors.brand.mid} />}
                title="We couldn't load your clients"
                body="Check your connection and try again."
                primaryAction={{
                  label: 'Try again',
                  onPress: () => {
                    void clientsQuery.refetch();
                  },
                }}
                density="coach"
                testID="assign-bulk-error"
              />
            ) : clients.length === 0 ? (
              <EmptyState
                icon={<Users size={22} color={theme.colors.fg.muted} />}
                title="No clients yet"
                body="You need at least one client before you can assign a program."
                primaryAction={{ label: 'Invite a client', onPress: onInviteClient }}
                density="coach"
                testID="assign-bulk-empty"
              />
            ) : filtered.length === 0 ? (
              <Text size="body-sm" tone="muted" testID="assign-bulk-no-match">
                No clients match
              </Text>
            ) : (
              <View testID="assign-bulk-list">
                {filtered.map((client, index) => (
                  <BulkClientRow
                    key={client.id}
                    client={client}
                    checked={selectedIds.has(client.id)}
                    isLast={index === filtered.length - 1}
                    onToggle={() => {
                      toggleClient(client.id);
                    }}
                  />
                ))}
              </View>
            )}

            <View style={styles.field}>
              <Text size="eyebrow" tone="warm-muted">
                Start date
              </Text>
              <BulkStartDateField
                startDate={startDate}
                today={today}
                isCalendarOpen={isCalendarOpen}
                onToggleCalendar={() => {
                  setCalendarOpen((current) => !current);
                }}
                onSelectDate={(date) => {
                  setStartDate(date);
                  setCalendarOpen(false);
                }}
              />
            </View>

            {bulkError ? (
              <Text
                size="body-sm"
                tone="urgent"
                accessibilityRole="alert"
                testID="assign-bulk-error-inline"
              >
                {bulkError}
              </Text>
            ) : null}
          </ScrollView>
          <SheetFooter
            actionLabel={footerLabel}
            onAction={handleBulkSubmit}
            isActionDisabled={!canSubmit}
            isActionLoading={bulkCreateAssignment.isPending}
            density="coach"
          />
        </>
      )}
    </Sheet>
  );
}

interface BulkClientRowProps {
  client: AssignableClient;
  checked: boolean;
  isLast: boolean;
  onToggle: () => void;
}

function BulkClientRow({ client, checked, isLast, onToggle }: BulkClientRowProps) {
  const theme = useTheme();
  const themed = useThemedStyles();
  const statusText = statusTextFor(client);

  return (
    <Pressable
      onPress={onToggle}
      // A checkbox is a checkbox — the role, plus `accessibilityState.checked`
      // below, is what announces the selection; the visible tick alone
      // never carries meaning on its own (`accessibility` §2).
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={client.name}
      accessibilityHint={statusText}
      style={[styles.bulkRow, isLast ? null : themed.bulkRowDivider]}
      testID={`assign-bulk-client-${client.id}`}
    >
      <View
        style={[styles.checkbox, checked ? themed.checkboxOn : themed.checkboxOff]}
        // The row's own `accessibilityState.checked` already announces
        // this; a second element here would say it twice.
        accessibilityElementsHidden
        importantForAccessibility="no"
        testID={`assign-bulk-check-${client.id}`}
      >
        {checked ? <Check size={13} strokeWidth={3} color={theme.colors.fg.onBrand} /> : null}
      </View>
      <Avatar size="sm" name={client.name} userId={client.id} />
      <View style={styles.grow}>
        <Text size="label" numberOfLines={1}>
          {client.name}
        </Text>
        <Text size="micro" tone="muted" numberOfLines={1}>
          {statusText}
        </Text>
      </View>
    </Pressable>
  );
}

interface BulkStartDateFieldProps {
  startDate: CalendarDate;
  today: CalendarDate;
  isCalendarOpen: boolean;
  onToggleCalendar: () => void;
  onSelectDate: (date: CalendarDate) => void;
}

function BulkStartDateField({
  startDate,
  today,
  isCalendarOpen,
  onToggleCalendar,
  onSelectDate,
}: BulkStartDateFieldProps) {
  const theme = useTheme();
  const themed = useThemedStyles();

  return (
    <>
      <Pressable
        onPress={onToggleCalendar}
        accessibilityRole="button"
        accessibilityLabel={`Start date, ${formatStartDateLabel(startDate, today)}`}
        accessibilityHint="Opens calendar"
        style={[styles.dateField, themed.dateField, { minHeight: tapTarget.MIN }]}
        testID="assign-bulk-start-date"
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
          onSelect={onSelectDate}
          today={today}
          density="coach"
          testID="assign-bulk-calendar"
        />
      ) : null}
    </>
  );
}

interface BulkOutcomeViewProps {
  programName: string;
  succeeded: readonly BulkSucceededRow[];
  conflicted: readonly BulkConflictedRow[];
  resolvingClientId: string | null;
  resolvingAction: 'pause' | 'complete' | null;
  isPausePending: boolean;
  isCompletePending: boolean;
  rowError: string | null;
  onResolve: (row: BulkConflictedRow, action: 'pause' | 'complete') => void;
  onDone: () => void;
}

/** Frame D — the outcome view, replacing the picker's body after the mutation. */
function BulkOutcomeView({
  programName,
  succeeded,
  conflicted,
  resolvingClientId,
  resolvingAction,
  isPausePending,
  isCompletePending,
  rowError,
  onResolve,
  onDone,
}: BulkOutcomeViewProps) {
  const theme = useTheme();
  const themed = useThemedStyles();
  const isResolving = resolvingClientId !== null;

  return (
    <>
      <SheetHeader
        title="Assignment results"
        subtitle={programName}
        onClose={onDone}
        density="coach"
      />
      <ScrollView
        contentContainerStyle={styles.bulkBody}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.statRow}>
          <View style={styles.statTile}>
            <Card elevation="raised" density="coach" testID="assign-outcome-stat-assigned">
              <View style={styles.statHeader}>
                <CircleCheck size={14} color={theme.colors.brand.DEFAULT} />
                <Text size="eyebrow" tone="warm-muted">
                  Assigned
                </Text>
              </View>
              <Text size="stat">{succeeded.length}</Text>
            </Card>
          </View>
          {/* Omitted entirely at zero conflicts — never an empty "Needs
              attention" tile (frame D's own rule). */}
          {conflicted.length > 0 ? (
            <View style={styles.statTile}>
              <Card elevation="tinted" density="coach" testID="assign-outcome-stat-attention">
                <View style={styles.statHeader}>
                  <TriangleAlert size={14} color={theme.colors.fg.warm} />
                  <Text size="eyebrow" tone="warm-muted">
                    Needs attention
                  </Text>
                </View>
                <Text size="stat">{conflicted.length}</Text>
              </Card>
            </View>
          ) : null}
        </View>

        {succeeded.length > 0 ? (
          <View style={styles.field}>
            <Text size="eyebrow" tone="warm-muted">
              {`Assigned · ${String(succeeded.length)}`}
            </Text>
            <View>
              {succeeded.map((row, index) => (
                <View
                  key={row.clientId}
                  style={[
                    styles.outcomeRow,
                    index === succeeded.length - 1 ? null : themed.bulkRowDivider,
                  ]}
                  testID={`assign-outcome-succeeded-${row.clientId}`}
                >
                  <Avatar size="sm" name={row.name} userId={row.clientId} />
                  <Text size="body-sm" style={styles.grow} numberOfLines={1}>
                    {row.name}
                  </Text>
                  <CircleCheck size={15} color={theme.colors.brand.DEFAULT} />
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Omitted entirely once every conflict resolves — never an empty section either. */}
        {conflicted.length > 0 ? (
          <View style={styles.field}>
            <Text size="eyebrow" tone="warm-muted">
              {`Needs attention · ${String(conflicted.length)}`}
            </Text>
            {rowError ? (
              <Text
                size="body-sm"
                tone="urgent"
                accessibilityRole="alert"
                testID="assign-outcome-row-error"
              >
                {rowError}
              </Text>
            ) : null}
            {conflicted.map((row) => {
              const first = firstNameOf(row.name);
              const isThisRow = resolvingClientId === row.clientId;
              return (
                <Card
                  key={row.clientId}
                  elevation="tinted"
                  density="coach"
                  testID={`assign-outcome-conflict-${row.clientId}`}
                >
                  <View style={styles.outcomeConflictContent}>
                    <View style={styles.outcomeConflictRow}>
                      <Avatar size="sm" name={row.name} userId={row.clientId} />
                      <View style={styles.grow}>
                        <Text size="label" numberOfLines={1}>
                          {row.name}
                        </Text>
                        <Text size="micro" tone="muted" numberOfLines={1}>
                          {`On ${row.programName}, week ${String(row.currentWeek)} of ${String(row.durationWeeks)}`}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.conflictActions}>
                      <Button
                        variant="secondary"
                        size="sm"
                        density="coach"
                        onPress={() => {
                          onResolve(row, 'pause');
                        }}
                        disabled={isResolving}
                        loading={isThisRow && resolvingAction === 'pause' && isPausePending}
                        accessibilityLabel={`Pause ${first}'s current program`}
                        testID={`assign-outcome-pause-${row.clientId}`}
                      >
                        Pause
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        density="coach"
                        onPress={() => {
                          onResolve(row, 'complete');
                        }}
                        disabled={isResolving}
                        loading={isThisRow && resolvingAction === 'complete' && isCompletePending}
                        accessibilityLabel={`Mark ${first}'s current program as complete`}
                        testID={`assign-outcome-complete-${row.clientId}`}
                      >
                        Complete
                      </Button>
                    </View>
                  </View>
                </Card>
              );
            })}
          </View>
        ) : null}
      </ScrollView>
      <SheetFooter
        actionLabel="Done"
        onAction={onDone}
        isActionDisabled={false}
        isActionLoading={false}
        density="coach"
      />
    </>
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
  // Bulk mode (frames C/D).
  bulkBody: {
    paddingHorizontal: spacing(14),
    paddingTop: spacing(12),
    paddingBottom: spacing(24),
    gap: spacing(12),
  },
  bulkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(11),
    minHeight: BULK_ROW_MIN_HEIGHT,
  },
  checkbox: {
    width: BULK_CHECKBOX,
    height: BULK_CHECKBOX,
    borderRadius: BULK_CHECKBOX_RADIUS,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  statRow: { flexDirection: 'row', gap: spacing(9) },
  statTile: { flex: 1 },
  statHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing(6) },
  outcomeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(11),
    paddingVertical: spacing(8),
  },
  outcomeConflictContent: { gap: spacing(10) },
  outcomeConflictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(11),
  },
});

const useThemedStyles = createThemedStyles((t) => ({
  dateField: {
    backgroundColor: t.colors.bg.inset,
    borderWidth: 1,
    borderColor: t.colors.border.soft,
  },
  bulkRowDivider: { borderBottomWidth: 1, borderBottomColor: t.colors.border.soft },
  checkboxOn: { backgroundColor: t.colors.brand.DEFAULT, borderColor: t.colors.brand.DEFAULT },
  checkboxOff: { backgroundColor: 'transparent', borderColor: t.colors.border.strong },
}));
