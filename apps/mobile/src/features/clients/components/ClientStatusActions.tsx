import {
  Card,
  ConfirmModal,
  Divider,
  Pressable,
  Text,
  createThemedValue,
  density,
  resolveButtonVariantVisuals,
  spacing,
  useTheme,
} from '@coachos/ui';
import { formatLocalDate } from '@coachos/utils';
import { Archive, Pause, Play, UserMinus, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { ClientOverview } from '../api.ts';
import { useClientStatus } from '../hooks/useClientStatus.ts';

// §8.3's relationship controls, as **rows at the foot of Overview** rather
// than a sheet from the header — the placement decision `/design` resolved.
//
// A sheet would hang off `ClientDetailTabBar`, which is shared chrome
// across all seven facets: Release would then be one tap from Chat, in the
// middle of writing a message. The navRow is 44px with one control and no
// room for a label, and `DESIGN.md` §13 forbids an icon travelling alone in
// navigation. Rows at the foot put the actions *after* the evidence — a
// coach arrives at "pause this client" having just read every reason to,
// which is the order a decision is actually made.
//
// **The layout is decided once, at mount, and never re-decided.** For an
// active or invited client the section is last; for a paused or archived
// one the statement well and the section are first, under the injuries
// banner. It never animates between the two: a pause taken at the foot
// leaves the card where the finger left it, and sliding it eleven hundred
// pixels under an open undo window would put Archive where Pause was,
// mid-gesture. The ROWS still follow the live status — only the layout is
// frozen.

export type ClientStatus = ClientOverview['status'];

export interface ClientStatusActionsProps {
  clientId: string;
  /** Every consequence line names the client (`product-copy` §4). */
  firstName: string;
  /** The two dialog titles, which name the person in full before ending something. */
  fullName: string;
  status: ClientStatus;
  /** `paused_at` / `archived_at`, for the statement well's headline. */
  statusSince: Date | null;
  /**
   * The route navigates; this component never touches the router
   * (`code-conventions` §1 — `app/**` owns where things lead).
   */
  onReleased: () => void;
  /** The coach's own zone. Injected only so a test has a fixed answer. */
  timeZone?: string;
  testID?: string;
}

type RowKey = 'pause' | 'resume' | 'archive' | 'release';

/**
 * Which rows a status may show — the mirror of `set-status.ts`'s
 * `LEGAL_TRANSITIONS`, plus release, which is `detachClient` rather than a
 * status change and therefore survives `archived`.
 *
 * **Absent, never disabled.** `invited` has no Pause row because
 * `invited -> paused` is refused: a pending invite is cancelled, not
 * paused. A greyed row would advertise an action that can never succeed,
 * and the coach would keep trying it.
 */
const ROWS_FOR_STATUS: Record<ClientStatus, readonly RowKey[]> = {
  active: ['pause', 'archive', 'release'],
  paused: ['resume', 'archive', 'release'],
  invited: ['archive', 'release'],
  archived: ['release'],
};

/** The two rows an open pause window makes inert — see `inertHint` below. */
const BLOCKED_BY_PENDING: readonly RowKey[] = ['archive', 'release'];

export function ClientStatusActions({
  clientId,
  firstName,
  fullName,
  status,
  statusSince,
  onReleased,
  timeZone,
  testID,
}: ClientStatusActionsProps) {
  const controls = useClientStatus(clientId, { firstName, onReleased });
  const [confirming, setConfirming] = useState<'archive' | 'release' | null>(null);

  // The status this block mounted with, and the only thing the statement
  // well reads. See the file header: the layout is frozen, the rows are
  // not. React's own derive-on-first-render, never an effect.
  const [statementStatus] = useState(status);

  const rows = ROWS_FOR_STATUS[status];

  function press(key: RowKey): void {
    switch (key) {
      case 'pause':
        controls.pause();
        return;
      case 'resume':
        controls.resume();
        return;
      case 'archive':
      case 'release':
        setConfirming(key);
    }
  }

  return (
    <View style={styles.root} testID={testID ?? 'client-status-actions'}>
      {statementStatus === 'paused' || statementStatus === 'archived' ? (
        <StatementWell
          status={statementStatus}
          since={statusSince}
          firstName={firstName}
          timeZone={timeZone}
        />
      ) : null}

      <Text size="eyebrow" tone="muted" style={styles.eyebrow}>
        RELATIONSHIP
      </Text>

      {/* `padded={false}`: each row owns its own padding so the divider
          between two of them insets itself by the density's card padding
          (`Divider`'s contract) rather than twice over. */}
      <Card elevation="raised" density="coach" padded={false}>
        {rows.map((key, index) => (
          <View key={key}>
            {index === 0 ? null : <Divider density="coach" />}
            <ActionRow
              rowKey={key}
              firstName={firstName}
              status={status}
              inert={controls.isPending && BLOCKED_BY_PENDING.includes(key)}
              onPress={() => {
                press(key);
              }}
            />
          </View>
        ))}
      </Card>

      {/* `ConfirmModal`'s header ships it with two sanctioned consumers —
          account deletion and client archival — and calls a third "a design
          review rather than an import". Release is that review's outcome:
          it is the same class of act as archival, irreversible in a way a
          five-second window cannot honestly cover, and `ui-conventions` §5
          would otherwise force it into an undo toast that promises a
          take-back which does not exist.

          Neither dialog passes `message`. Both are optimistic and close
          before the write lands, so there is no open dialog for a failure
          to land in — `useClientStatus` rolls the two cache entries back
          instead, silently. Giving them the slot means first deciding that
          a coach should wait on the network here, which is a behaviour
          change to a shipped flow rather than a use of a new prop. */}
      <ConfirmModal
        isOpen={confirming === 'archive'}
        onCancel={() => {
          setConfirming(null);
        }}
        onConfirm={() => {
          setConfirming(null);
          controls.archive();
        }}
        title={`Archive ${fullName}`}
        body={archiveBody(firstName)}
        confirmationText="ARCHIVE"
        actionLabel="Archive client"
        testID="client-archive-confirm"
      />

      <ConfirmModal
        isOpen={confirming === 'release'}
        onCancel={() => {
          setConfirming(null);
        }}
        onConfirm={() => {
          setConfirming(null);
          controls.release();
        }}
        title={`Release ${fullName}`}
        body={releaseBody(firstName)}
        confirmationText="RELEASE"
        actionLabel="Release client"
        testID="client-release-confirm"
      />
    </View>
  );
}

// ── Copy ────────────────────────────────────────────────────────────────
//
// Every string is built from `{firstName}` plus a **neutral possessive —
// singular they**, as one whole sentence rather than concatenated fragments
// (`product-copy` §6: all strings extracted for localisation, never
// assembled from pieces). The product collects no gender, so "her"/"his"
// would be a guess, and a guess about a person is exactly the kind of
// assertion this product does not make. Nothing below asks "are you sure" —
// a confirmation states the consequence (`product-copy` §5).

const LABEL: Record<RowKey, string> = {
  pause: 'Pause coaching',
  resume: 'Resume coaching',
  archive: 'Archive client',
  release: 'Release client',
};

const GLYPH: Record<RowKey, LucideIcon> = {
  pause: Pause,
  resume: Play,
  archive: Archive,
  release: UserMinus,
};

/** Archive and release turn urgent **in the press moment only** — see `ActionRow`. */
const DANGER_ROWS: readonly RowKey[] = ['archive', 'release'];

function consequence(key: RowKey, firstName: string, status: ClientStatus): string {
  switch (key) {
    case 'pause':
      return `Nothing is scheduled and no reminders go out. ${firstName}'s seat is free while they are paused.`;
    case 'resume':
      return 'Sessions are scheduled again from today.';
    case 'archive':
      return `${firstName} keeps everything and is not notified. You keep their history.`;
    case 'release':
      // From `archived` there is nothing left to undo it with — an
      // archived client cannot be resumed, so a release from here is the
      // end of the record rather than the end of the arrangement.
      return status === 'archived'
        ? `Ends your coaching for good. ${firstName} is emailed, and most of what you can read closes in 30 days.`
        : `Ends your coaching. ${firstName} is emailed, and most of what you can read closes in 30 days.`;
  }
}

/**
 * What a screen reader says instead of the visible label — the visible one
 * says "Archive client", which names a kind of person rather than this
 * person (`accessibility` §2: label an action, with its object).
 */
function spokenLabel(key: RowKey, firstName: string): string {
  switch (key) {
    case 'pause':
      return `Pause coaching with ${firstName}`;
    case 'resume':
      return `Resume coaching with ${firstName}`;
    case 'archive':
      return `Archive ${firstName}`;
    case 'release':
      return `Release ${firstName}`;
  }
}

/** The hint says what happens AND what the next step is, so nothing surprises. */
function spokenHint(key: RowKey): string {
  switch (key) {
    case 'pause':
      return 'Nothing is scheduled while they are paused. You will have five seconds to undo.';
    case 'resume':
      return 'Sessions are scheduled again from today. You will have five seconds to undo.';
    case 'archive':
      return 'They keep everything and are not notified. You will be asked to type ARCHIVE.';
    case 'release':
      return 'This ends your coaching and emails them. You will be asked to type RELEASE.';
  }
}

/** Why a row cannot be pressed right now, rather than silence. */
const INERT_HINT = 'Available once the pause finishes saving.';

function archiveBody(firstName: string): string {
  return `${firstName} keeps every workout, meal, photo and message. They are not notified. You keep their full history and can reopen it here. Their seat is released, so you can invite another client.`;
}

/**
 * `account-lifecycle/06`'s transition table in four sentences, and the
 * order is deliberate: **what the client keeps comes first**, because a
 * coach's fear here is that releasing deletes the record, and it never
 * does. Not one row is deleted by this action (`CLAUDE.md` §21.3).
 */
function releaseBody(firstName: string): string {
  return `${firstName} keeps everything. We email them to say you have stopped working together. Their meals, measurements and photos close to you today. Their sessions, check-ins, videos, comments and messages stay readable for 30 days, then close too.`;
}

// ── Rows ────────────────────────────────────────────────────────────────

interface ActionRowProps {
  rowKey: RowKey;
  firstName: string;
  status: ClientStatus;
  inert: boolean;
  onPress: () => void;
}

/**
 * One row: glyph, label, consequence. **No chevron** — a chevron promises a
 * screen, and three of these four do something instead of going somewhere.
 * **No haptic** — `packages/ui/src/haptics` is a closed set of four, and
 * none of them is "a coach pressed a row" (`ui-conventions` §5).
 */
function ActionRow({ rowKey, firstName, status, inert, onPress }: ActionRowProps) {
  const theme = useTheme();
  const restingIcon = useRestingIconColor();
  const inertIcon = useInertIconColor();
  // The danger colour read through `Button`'s own resolver rather than off
  // the palette: `colors['urgent-text']` belongs to the adherence ramp and
  // the `theme/adherence-colors-only` lint rule is what keeps it there.
  // This row and `Button`'s outlined `danger` variant are the same
  // destructive moment and must not disagree about its colour.
  const urgentIcon = resolveButtonVariantVisuals('danger', true, false, theme).textColor;
  const Glyph = GLYPH[rowKey];
  const isDanger = DANGER_ROWS.includes(rowKey);

  return (
    <Pressable
      onPress={inert ? undefined : onPress}
      disabled={inert}
      // `DESIGN.md` §5's press feedback, one step shallower than the
      // product default: a full-width row scaling .97 reads as the whole
      // card moving.
      pressScale={ROW_PRESS_SCALE}
      accessibilityRole="button"
      accessibilityLabel={spokenLabel(rowKey, firstName)}
      accessibilityHint={inert ? INERT_HINT : spokenHint(rowKey)}
      style={[styles.row, inert && styles.rowInert]}
    >
      {({ pressed }) => {
        // Neutral at rest, urgent only while the finger is down: §1.1
        // reserves the warm-urgent ramp for the destructive MOMENT, and a
        // permanently red row would sit in a coach's peripheral vision on
        // every client they open.
        const danger = isDanger && pressed && !inert;
        const iconColor = inert ? inertIcon : danger ? urgentIcon : restingIcon;

        return (
          <>
            <Glyph size={ROW_GLYPH} color={iconColor} style={styles.glyph} />
            <View style={styles.body}>
              <Text size="label" tone={inert ? 'faint' : danger ? 'urgent' : 'default'}>
                {LABEL[rowKey]}
              </Text>
              <Text
                size="caption"
                tone={inert ? 'faint' : 'muted'}
                style={styles.consequence}
                // Wraps rather than truncates: the consequence IS the
                // control's meaning, and a clipped one is a control with no
                // label (`accessibility` §3).
                textBreakStrategy="balanced"
              >
                {consequence(rowKey, firstName, status)}
              </Text>
            </View>
          </>
        );
      }}
    </Pressable>
  );
}

// ── The statement well ──────────────────────────────────────────────────

interface StatementWellProps {
  status: 'paused' | 'archived';
  since: Date | null;
  firstName: string;
  /** `exactOptionalPropertyTypes`: absent and explicitly-undefined differ. */
  timeZone: string | undefined;
}

/**
 * Why this client is not being coached this week, stated once.
 *
 * Drawn in the `InjuriesBanner` / `PrivacyLabel` register — an L1 inset
 * well, warm-muted glyph, no border colour borrowed from the adherence
 * ramp — and it **carries no button**. Recession is what separates it from
 * the raised cards around it; a control inside would make it a second,
 * competing place to act, one scroll from the section that already is one.
 */
function StatementWell({ status, since, firstName, timeZone }: StatementWellProps) {
  const iconColor = useWarmIconColor();
  const Glyph = status === 'paused' ? Pause : Archive;
  const headline = wellHeadline(status, since, timeZone);
  const body = wellBody(status, firstName);

  return (
    <Card elevation="inset" density="coach" testID={`client-status-well-${status}`}>
      {/* One accessible item, one sentence — four fragments is noise in the
          reading order (`accessibility` §2), and the grouping sits here
          because `Card` sets `accessible={false}` on its own container. */}
      <View style={styles.well} accessible accessibilityLabel={`${headline}. ${body}`}>
        <Glyph size={WELL_GLYPH} color={iconColor} style={styles.glyph} />
        <View style={styles.body}>
          <Text size="body-sm">{headline}</Text>
          <Text size="caption" tone="muted" style={styles.consequence}>
            {body}
          </Text>
        </View>
      </View>
    </Card>
  );
}

/** The coach paused this client on this device, so the device's zone is theirs. */
function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * "Paused since Friday 11 September" · "Archived on 4 September".
 *
 * The weekday is on the pause and not on the archive because a pause is a
 * state a coach is still inside — "which day of this week did that start"
 * is the question they are asking — while an archive is a closed act.
 *
 * `since` is `null` whenever the timestamp has not reached this screen, and
 * then the headline is the bare fact. Never an invented date, and never a
 * half sentence with a gap in it.
 */
function wellHeadline(
  status: 'paused' | 'archived',
  since: Date | null,
  timeZone = deviceTimeZone(),
): string {
  if (since === null) return status === 'paused' ? 'Paused' : 'Archived';
  if (status === 'paused') {
    return `Paused since ${formatLocalDate(since, timeZone, 'EEEE d MMMM')}`;
  }
  return `Archived on ${formatLocalDate(since, timeZone, 'd MMMM')}`;
}

function wellBody(status: 'paused' | 'archived', firstName: string): string {
  return status === 'paused'
    ? `Nothing is scheduled and no reminders go out. ${firstName}'s seat is free. They can still open the app and log against their last program.`
    : `${firstName}'s history stays here and they keep their own. They were not notified. To work together again, send a new invite.`;
}

// ── Geometry ────────────────────────────────────────────────────────────

const ROW_GLYPH = 18;
const WELL_GLYPH = 18;
const ROW_PRESS_SCALE = 0.99;
/**
 * `11 + 20 + 3 + 17 + 11` — padding, the `label` line box, the gap, the
 * `caption` line box, padding. `minHeight`, never `height`: at 200% text
 * both lines grow and the consequence wraps rather than clips
 * (`accessibility` §3).
 */
const ROW_MIN_HEIGHT = 62;

const styles = StyleSheet.create({
  root: { marginTop: spacing(22) },
  eyebrow: { marginTop: spacing(16), marginBottom: spacing(8) },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing(11),
    minHeight: ROW_MIN_HEIGHT,
    paddingVertical: spacing(11),
    paddingHorizontal: density.coach.cardPadding,
  },
  // The one disabled treatment in this file. `opacity` rather than a colour
  // swap so the row keeps its shape and nothing has to be re-measured.
  rowInert: { opacity: 0.45 },
  // Optically aligned to the label's cap height rather than its box.
  glyph: { marginTop: spacing(3) },
  body: { flex: 1, minWidth: 0 },
  consequence: { marginTop: spacing(3) },
  well: { flexDirection: 'row', gap: spacing(11) },
});

const useRestingIconColor = createThemedValue((t) => t.colors.fg.muted);
const useInertIconColor = createThemedValue((t) => t.colors.fg.faint);
const useWarmIconColor = createThemedValue((t) => t.colors.fg['warm-muted']);
