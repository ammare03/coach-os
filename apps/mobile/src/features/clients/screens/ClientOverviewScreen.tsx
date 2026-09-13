import {
  ADHERENCE_STATE_LABEL,
  AdherenceDot,
  Card,
  EmptyState,
  LoadingState,
  Metric,
  NotFoundState,
  Sparkline,
  Text,
  createThemedStyles,
  createThemedValue,
  density,
  spacing,
} from '@coachos/ui';
import { formatLocalDate } from '@coachos/utils';
import { TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useWeightUnit } from '../../../hooks/useWeightUnit.ts';
import { getErrorCode } from '../../../lib/error-code.ts';
import { useClientOverview, type ClientOverview, type PinnedNote } from '../api.ts';
import { ClientStatusActions } from '../components/ClientStatusActions.tsx';
import { InjuriesBanner } from '../components/InjuriesBanner.tsx';
import { PrivacyLabel } from '../components/PrivacyLabel.tsx';
import { WeightTrendChart } from '../components/WeightTrendChart.tsx';

import { firstNameOf } from './ClientNotesScreen.tsx';

// §8.3's Overview tab: "weight trend chart, adherence sparkline, current
// program + week, upcoming check-in, pinned notes, injuries banner."
//
// A **Detail read** (`UI-UX.md` §UX2) over exactly ONE query. The task's
// Risks section names the alternative and rules it out: five calls assembled
// here would each have their own latency and their own failure, and the
// screen's whole premise is a single glance.
//
// **No per-section error boundary, deliberately.** `screen-composition` §3's
// rule is that no screen fails as a whole because one part failed — and with
// one query there is no one part that can fail alone. The shell survives
// regardless: the facet bar lives in `_layout.tsx`, so a failed Overview
// leaves the back control and the other five tabs working, which is the
// property §3 is actually protecting. What each section owns instead is its
// own EMPTY treatment at its own footprint, below. When a later phase splits
// a section onto its own query, that section gets a boundary then.

export interface ClientOverviewScreenProps {
  clientId: string;
  /** Where "not your client" and "go back" lead. Never a query-dependent action (`screen-composition` §3). */
  onBack: () => void;
  /** Where a released client's screen goes. The route decides; this screen only reports it. */
  onReleased: () => void;
}

/**
 * Where the relationship block sits, decided ONCE — on the first render
 * that has a status to decide from, and never again
 * (`relationship-controls/01`).
 *
 * For an active or invited client it is last: the actions come after the
 * evidence, which is the order a decision is actually made. For a paused or
 * archived one it is first, because "why is nothing happening here" is the
 * question the screen now has to answer before anything else on it means
 * anything.
 *
 * It never animates between the two. A pause taken at the foot of the
 * screen leaves the card where the finger left it; sliding it to the top
 * under an open undo window would move Archive to where Pause just was.
 */
type BlockPlacement = 'top' | 'foot';

function placementFor(status: ClientOverview['status']): BlockPlacement {
  return status === 'paused' || status === 'archived' ? 'top' : 'foot';
}

export function ClientOverviewScreen({ clientId, onBack, onReleased }: ClientOverviewScreenProps) {
  const themed = useThemedStyles();
  const unit = useWeightUnit();
  const overview = useClientOverview(clientId);

  // React's own derive-during-render, not an effect: the first render with
  // data fixes the placement and every render after it reads the same
  // answer. An effect would place the block, commit, and move it.
  const [placement, setPlacement] = useState<BlockPlacement | null>(null);
  const loadedStatus = overview.data?.status;
  if (placement === null && loadedStatus !== undefined) {
    setPlacement(placementFor(loadedStatus));
  }

  if (overview.isPending) {
    return (
      <View style={[styles.flex, themed.screen]}>
        <LoadingState
          shape="detail"
          density="coach"
          accessibilityLabel="Loading this client's week"
        />
      </View>
    );
  }

  if (overview.isError) {
    return (
      <View style={[styles.flex, themed.screen]}>
        <OverviewFailure
          error={overview.error}
          onBack={onBack}
          onRetry={() => {
            void overview.refetch();
          }}
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.flex, themed.screen]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      testID="client-overview"
    >
      {/* First, and unconditional when non-empty (§8.3 AC). Anything a coach
          must not miss cannot sit below a chart — including the statement
          that follows it, which explains the screen rather than warning
          about the person. */}
      <InjuriesBanner injuries={overview.data.injuries} />

      {placement === 'top' ? (
        <RelationshipBlock overview={overview.data} onReleased={onReleased} />
      ) : null}

      {/* Nothing below is dimmed for a paused client. 82% is still what
          happened in the seven days before they stopped, and greying it
          would say otherwise. */}
      <WeightTrendChart points={overview.data.weightTrend} unit={unit} />

      <AdherenceCard adherence={overview.data.adherence} />

      <ProgramCard program={overview.data.program} />

      <CheckinCard checkin={overview.data.nextCheckin} />

      <PinnedNotes notes={overview.data.pinnedNotes} />

      {placement === 'foot' ? (
        <RelationshipBlock overview={overview.data} onReleased={onReleased} />
      ) : null}
    </ScrollView>
  );
}

interface RelationshipBlockProps {
  overview: ClientOverview;
  onReleased: () => void;
}

/**
 * Pause, resume, archive and release, wherever `placement` put them.
 *
 * `statusSince` is `null` because `coach.clients.overview` does not return
 * `paused_at` or `archived_at` — the statement well and the header chip
 * therefore state the status without a date rather than inventing one.
 * Adding the two columns to `features/coach/client-overview.ts`'s identity
 * select is the whole of the change that fills them in.
 */
function RelationshipBlock({ overview, onReleased }: RelationshipBlockProps) {
  return (
    <ClientStatusActions
      clientId={overview.clientId}
      firstName={firstNameOf(overview.name)}
      fullName={overview.name}
      status={overview.status}
      statusSince={null}
      onReleased={onReleased}
    />
  );
}

interface OverviewFailureProps {
  error: unknown;
  onBack: () => void;
  onRetry: () => void;
}

/**
 * Two states, not one. `NOT_YOUR_CLIENT` is the id being wrong — a stale
 * deep link, a released client — and its way out is back to the roster; a
 * network failure is the same client, unreachable, and its way out is to
 * try again. `ERRORS.md` ER§2.1 makes another coach's client return
 * NOT_FOUND rather than FORBIDDEN, so this renders `NotFoundState` and
 * never `ForbiddenState` — a 403 here would confirm the row exists and turn
 * id-walking into an enumeration oracle.
 */
function OverviewFailure({ error, onBack, onRetry }: OverviewFailureProps) {
  const iconColor = useMutedIconColor();

  if (getErrorCode(error) === 'NOT_YOUR_CLIENT') {
    return (
      <NotFoundState
        title="We couldn't find that client"
        body="They may have left your roster, or the link is out of date."
        onRecover={onBack}
        recoverLabel="Back to clients"
        density="coach"
        testID="client-overview-not-found"
      />
    );
  }

  return (
    <EmptyState
      icon={<TriangleAlert size={22} color={iconColor} />}
      title="We couldn't load this client"
      body="Check your connection and try again. Nothing they have logged is affected."
      primaryAction={{ label: 'Try again', onPress: onRetry }}
      density="coach"
      testID="client-overview-error"
    />
  );
}

interface AdherenceCardProps {
  adherence: ClientOverview['adherence'];
}

/**
 * §8.3's adherence sparkline, with the figure it summarises.
 *
 * The percentage and the state word both arrive from the server, resolved
 * by the same `packages/utils` functions the dashboard row uses — so the dot
 * here and the dot beside this client's name one screen back can never
 * disagree (`adherence-engine/01`: the thresholds live in exactly one
 * place).
 */
function AdherenceCard({ adherence }: AdherenceCardProps) {
  const points = adherence.trend.map((week) => ({
    dateISO: week.weekStartISO,
    value: week.trainingAdherence,
  }));

  // The word comes from the server, which resolved it through
  // `adherenceState()` in `packages/utils` — the one place §8.2's thresholds
  // live. A comparison written here would be a second copy of them, which is
  // exactly what `adherence-engine/01` exists to prevent.
  const state = adherence.state;

  return (
    <Card density="coach" testID="adherence-summary">
      <View style={styles.cardRow}>
        <View style={styles.cardMain}>
          <Text size="eyebrow" tone="muted">
            ADHERENCE · LAST 7 DAYS
          </Text>

          {adherence.overallAdherence === null ? (
            // Grey and a dash, never 0% and never red: absence of data is
            // not failure (`DESIGN.md` §10.5, `adherence-engine/01`).
            <Text size="body-sm" tone="muted" style={styles.value}>
              Nothing scheduled yet
            </Text>
          ) : (
            <>
              <View style={styles.value}>
                <Metric value={Math.round(adherence.overallAdherence)} unit="%" size="stat" />
              </View>
              <Text size="caption" tone="muted" style={styles.sub}>
                {describeSessions(adherence)}
              </Text>
            </>
          )}
        </View>

        <View style={styles.cardAside}>
          {/* A mark with no label is noise in the reading order; with one it
              is the trend in a word (`accessibility` §2, §8). */}
          <Sparkline
            points={points}
            gapDays={SPARKLINE_GAP_DAYS}
            accessibilityLabel="Training adherence, weekly, last 8 weeks"
          />
          <AdherenceDot state={state} size="sm" label={ADHERENCE_STATE_LABEL[state]} />
        </View>
      </View>
    </Card>
  );
}

/**
 * One week to the next is exactly 7 days, so the chart default (3) would
 * break every segment. Same reasoning as `WeightTrendChart`'s.
 */
const SPARKLINE_GAP_DAYS = 7;

/**
 * "4 of 5 sessions · 6 of 7 days logged" — counts, never a judgement. Loss
 * framing ("1 missed") is the same fact worded as an accusation, and the
 * coach app has no more licence to shame than the client app does when the
 * words could be read aloud to the client (`product-copy` §3).
 */
export function describeSessions(adherence: ClientOverview['adherence']): string {
  const sessions =
    adherence.sessionsScheduled7d > 0
      ? `${String(adherence.sessionsCompleted7d)} of ${String(adherence.sessionsScheduled7d)} sessions`
      : 'No sessions scheduled';

  if (adherence.nutritionAdherence === null) {
    return sessions;
  }

  return `${sessions} · nutrition ${String(Math.round(adherence.nutritionAdherence))}%`;
}

interface ProgramCardProps {
  program: ClientOverview['program'];
}

function ProgramCard({ program }: ProgramCardProps) {
  return (
    <Card density="coach" testID="current-program">
      <Text size="eyebrow" tone="muted">
        CURRENT PROGRAM
      </Text>

      {program === null ? (
        // Stating the fact, and no action: assigning a program is
        // `phase-07`'s sheet and it is reached from the Training tab, not
        // invented here (`client-detail/02`).
        <Text size="body-sm" tone="muted" style={styles.value}>
          No program assigned
        </Text>
      ) : (
        <>
          <Text size="title" numberOfLines={2} style={styles.value}>
            {program.name}
          </Text>
          <Text size="caption" tone="muted" style={styles.sub}>
            {`Week ${String(program.currentWeek)} of ${String(program.durationWeeks)}`}
          </Text>
        </>
      )}
    </Card>
  );
}

interface CheckinCardProps {
  checkin: ClientOverview['nextCheckin'];
}

function CheckinCard({ checkin }: CheckinCardProps) {
  return (
    <Card density="coach" testID="next-checkin">
      <Text size="eyebrow" tone="muted">
        NEXT CHECK-IN
      </Text>

      {checkin === null ? (
        <Text size="body-sm" tone="muted" style={styles.value}>
          None scheduled
        </Text>
      ) : (
        <>
          <Text size="title" style={styles.value}>
            {`Due ${formatCalendarDate(checkin.periodEnd)}`}
          </Text>
          <Text size="caption" tone="muted" style={styles.sub}>
            {describeCheckin(checkin)}
          </Text>
        </>
      )}
    </Card>
  );
}

/**
 * "Covers 8 Sep to 14 Sep · submitted, not yet reviewed". Two facts and no
 * verdict — "overdue" would be a judgement about a person, which the
 * product never makes (`product-copy` §1).
 */
export function describeCheckin(checkin: NonNullable<ClientOverview['nextCheckin']>): string {
  const period = `Covers ${formatCalendarDate(checkin.periodStart)} to ${formatCalendarDate(checkin.periodEnd)}`;
  const state = checkin.status === 'submitted' ? 'submitted, not yet reviewed' : 'not submitted';
  return `${period} · ${state}`;
}

/**
 * `yyyy-MM-dd` → "14 Sep" (`product-copy` §6: absolute beyond a week).
 *
 * Pinned to UTC, and that is not a shortcut: `periodStart` / `periodEnd`
 * are `date` columns — a calendar day, not an instant (`code-conventions`
 * §6). Reading them in the device's zone would render 14 September as the
 * 13th for a coach west of UTC, which is the single most common date bug in
 * this product (`CLAUDE.md` §25.5).
 */
export function formatCalendarDate(dateISO: string): string {
  return formatLocalDate(new Date(`${dateISO}T00:00:00Z`), 'UTC', 'd MMM');
}

interface PinnedNotesProps {
  notes: readonly PinnedNote[];
}

/**
 * Read-only here, by design. §8.3 puts pinned notes on Overview and
 * `coach-notes` owns creating, editing, and pinning them — this renders the
 * list the `overview` procedure already returned rather than issuing a
 * second query for the same rows (see `features/coach/client-overview.ts`'s
 * `pinnedNotesQuery`).
 */
function PinnedNotes({ notes }: PinnedNotesProps) {
  return (
    <View style={styles.notes} testID="pinned-notes">
      <Text size="eyebrow" tone="muted">
        PINNED NOTES
      </Text>

      {/* `DESIGN.md` §10.6: coach notes are private, and the surface says so
          rather than leaving the coach to assume it. This replaced an 11px
          uppercase `· ONLY YOU CAN SEE THESE` eyebrow — fine print is
          exactly what §8.3's "labelled explicitly" rules out
          (`coach-notes/02`). One component, two call sites: the other is
          the Notes tab's fixed head. */}
      <View style={styles.notesLabel}>
        <PrivacyLabel />
      </View>

      {notes.length === 0 ? (
        <Text size="body-sm" tone="muted" style={styles.value}>
          Nothing pinned yet
        </Text>
      ) : (
        notes.map((note) => (
          <View key={note.noteId} style={styles.note}>
            <Card density="coach">
              <Text size="body-sm">{note.body}</Text>
            </Card>
          </View>
        ))
      )}
    </View>
  );
}

const GUTTER = density.coach.gutter;
const SECTION_GAP = density.coach.sectionGap;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: GUTTER, gap: spacing(12), paddingBottom: spacing(40) },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing(12) },
  cardMain: { flex: 1, minWidth: 0 },
  cardAside: { alignItems: 'flex-end', gap: spacing(6) },
  value: { marginTop: spacing(4) },
  sub: { marginTop: spacing(3) },
  notes: { marginTop: SECTION_GAP },
  notesLabel: { marginTop: spacing(9) },
  note: { marginTop: spacing(9) },
});

const useThemedStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.colors.bg.DEFAULT },
}));

const useMutedIconColor = createThemedValue((t) => t.colors.fg.muted);
