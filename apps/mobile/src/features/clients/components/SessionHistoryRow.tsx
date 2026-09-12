import { Card, Text, createThemedValue, density, fontSize, spacing } from '@coachos/ui';
import { formatLocalDate, formatWeight, type WeightUnit } from '@coachos/utils';
import { ChevronRight } from 'lucide-react-native';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import type { SessionHistoryItem } from '../api.ts';

// One logged session, one row — §8.3's exact field list for the Training
// tab: date, program-day name, duration, volume, PR count, reviewed state.
// Nothing else earns a place, and nothing here fetches: every figure below
// arrives in the page `coach.clients.trainingHistory` already returned
// (`screen-composition` §2, and this task's Risks section).

const CARD_PADDING = density.coach.cardPadding; // 14
const EYEBROW_LINE = fontSize.eyebrow[1].lineHeight; // '16px'
const NAME_LINE = fontSize.label[1].lineHeight; // '20px'
const META_LINE = fontSize.micro[1].lineHeight; // '15px'
const DATE_NAME_GAP = spacing(5);
const NAME_META_GAP = spacing(3);

/** The gap between two rows. Inside the row's own footprint, so the recycler measures it. */
export const SESSION_ROW_GAP = spacing(10);

function px(value: string): number {
  return Number.parseInt(value, 10);
}

/**
 * **The measured row height, and the row's own `minHeight`.**
 *
 * FlashList v2 has no `estimatedItemSize` — the prop was removed with v2's
 * recycler rewrite, which measures rows itself. So this number is applied
 * to the row rather than handed to the list, and that is what `CLAUDE.md`
 * §25.8 is really asking for: every row reports a stable, uniform size on
 * first layout instead of settling over several frames. Same reasoning,
 * same derivation, as `ClientRow`'s `CLIENT_ROW_HEIGHT` one screen back.
 *
 * ```
 *   14  card paddingTop      (coach density)
 * + 16  date + flag line     — `eyebrow`, lineHeight 16
 * +  5  gap
 * + 20  session name         — `label`,   lineHeight 20
 * +  3  gap
 * + 15  meta                 — `micro`,   lineHeight 15
 * + 14  card paddingBottom
 * + 10  gap to the next row
 * = 97
 * ```
 *
 * The 15px chevron sits inside the 38px name-and-meta block, so it never
 * sets the height. Read from `fontSize` and `density` rather than written
 * as literals, so a change to either moves this number with it instead of
 * silently invalidating it.
 *
 * At 200% text the row grows past this — which is why it is a `minHeight`
 * and why nothing here pins a fixed `height` (`accessibility` §3).
 */
export const SESSION_ROW_HEIGHT =
  CARD_PADDING * 2 +
  px(EYEBROW_LINE) +
  DATE_NAME_GAP +
  px(NAME_LINE) +
  NAME_META_GAP +
  px(META_LINE) +
  SESSION_ROW_GAP;

const SECONDS_PER_MINUTE = 60;

/**
 * The one word for an unreviewed session, borrowed rather than invented.
 *
 * It is the dashboard counter's own label (`DashboardCounters`'
 * `COUNTER_LABEL.needsReview`), and the counter counts exactly the sessions
 * this flag marks. Two surfaces, one phrase — the same rule that made the
 * middle counter say "Off plan".
 */
export const NEEDS_REVIEW_LABEL = 'Needs review';

/** The fallback name, matching the client's own session summary (`features/workouts/lib/session-summary.ts`). */
const UNTITLED_SESSION = 'Workout';

export interface SessionHistoryRowProps {
  session: SessionHistoryItem;
  unit: WeightUnit;
  /** Takes the id, never a closure over the row — a new arrow per row defeats `memo`. */
  onPress: (sessionId: string) => void;
  testID?: string;
}

/**
 * `React.memo` because this renders a year of history and re-renders
 * whenever a page lands (`frontend-performance` §3).
 */
export const SessionHistoryRow = memo(function SessionHistoryRow({
  session,
  unit,
  onPress,
  testID,
}: SessionHistoryRowProps) {
  const chevronColor = useChevronColor();

  const needsReview = session.reviewedAt === null;
  const date = formatSessionDate(session.scheduledDate);
  const name = session.name ?? UNTITLED_SESSION;
  const meta = describeSession(session, unit);

  return (
    <View style={styles.row}>
      <Card
        // `DESIGN.md` §2: L3 is "the only way to say *this one is different*
        // without colour-coding it", and it is the recipe the dashboard
        // already uses for the selected **Needs review** counter. Borrowed
        // whole rather than mapped to a second treatment.
        elevation={needsReview ? 'tinted' : 'raised'}
        density="coach"
        onPress={() => {
          onPress(session.sessionId);
        }}
        // One sentence per session, not six fragments — and "Needs review"
        // arrives as a WORD, which is also what makes the tinted card
        // readable with no colour vision at all (`accessibility` §2, §4).
        accessibilityLabel={buildRowLabel(date, name, meta, needsReview)}
        testID={testID ?? `session-row-${session.sessionId}`}
      >
        <View style={styles.head}>
          <Text size="eyebrow" tone="muted" style={styles.tabular}>
            {date.toUpperCase()}
          </Text>
          <View style={styles.spacer} />
          {needsReview ? (
            <Text size="eyebrow" tone="warm">
              {NEEDS_REVIEW_LABEL.toUpperCase()}
            </Text>
          ) : null}
        </View>

        <View style={styles.body}>
          <View style={styles.main}>
            <Text
              size="label"
              numberOfLines={1}
              tone={session.status === 'skipped' ? 'muted' : 'default'}
            >
              {name}
            </Text>
            {/* `DESIGN.md` §1.2 — tabular figures on every number, without
                exception, so a column of durations and volumes lines up. */}
            <Text size="micro" tone="muted" numberOfLines={1} style={[styles.meta, styles.tabular]}>
              {meta.facts}
              {/* `DESIGN.md` §8 gives records the warm ramp, and only them.
                  The count is still a WORD ("2 PRs"), so the colour is
                  emphasis and never the message (`accessibility` §4). The
                  §8 celebration — the `prpop` overshoot — is the client's
                  one moment and is deliberately not reused here. */}
              {meta.records === null ? null : (
                <Text size="micro" tone="warm">{` · ${meta.records}`}</Text>
              )}
            </Text>
          </View>

          {/* `fg.faint` never carries meaning (`DESIGN.md` §13) — the chevron
              says "this opens", which the card's `button` role already says
              out loud. Same treatment, same colour, as `ClientRow`'s. */}
          <ChevronRight size={15} color={chevronColor} />
        </View>
      </Card>
    </View>
  );
});

/**
 * `yyyy-MM-dd` → "Tue 9 Sep", and "Tue 9 Sep 2025" outside the current year.
 *
 * **Absolute, never relative**, and pinned to UTC. `scheduled_date` is a
 * `date` column — the CLIENT's local training day, not an instant
 * (`code-conventions` §6) — so reading it in the coach's device zone would
 * render 9 September as the 8th for a coach west of UTC, which is the
 * single most common date bug in this product (`CLAUDE.md` §25.5).
 *
 * `product-copy` §6 puts relative dates inside a week and absolute ones
 * beyond. "Today" is not available to this row without knowing the
 * client's own zone, and the coach app biases to density and precision
 * anyway (`ui-conventions` §1) — a weekday plus a date is unambiguous for a
 * coach in Mumbai reading a client in Toronto, which "Yesterday" is not.
 */
export function formatSessionDate(dateISO: string, now: Date = new Date()): string {
  const instant = new Date(`${dateISO}T00:00:00Z`);
  const sameYear = formatLocalDate(instant, 'UTC', 'yyyy') === String(now.getFullYear());
  return formatLocalDate(instant, 'UTC', sameYear ? 'EEE d MMM' : 'EEE d MMM yyyy');
}

/** The meta line, split where the row changes colour — never where it changes meaning. */
export interface SessionMeta {
  /** "48 min · 7240 kg", "Skipped · travelling", "In progress". */
  facts: string;
  /** "2 PRs", or `null` when this session set none that still stand. */
  records: string | null;
}

/**
 * "48 min · 7240 kg · 2 PRs" — counts and facts, never a verdict.
 *
 * A coach may be blunt, but these words can be read aloud to the client, so
 * a skipped session states the client's own reason and adds nothing to it
 * (`product-copy` §3). A session with no settled volume states none rather
 * than a zero: "0 kg" is a claim about the workout that is simply false,
 * and "0 PRs" is loss framing for a perfectly good session.
 */
export function describeSession(session: SessionHistoryItem, unit: WeightUnit): SessionMeta {
  if (session.status === 'skipped') {
    return {
      facts: session.skipReason === null ? 'Skipped' : `Skipped · ${session.skipReason}`,
      records: null,
    };
  }

  const parts: string[] = [];

  // An in-progress session's duration is still running, so the row states
  // what it is rather than a figure that was true when the page loaded.
  if (session.status === 'in_progress') {
    parts.push('In progress');
  } else if (session.durationSeconds !== null) {
    parts.push(`${String(Math.round(session.durationSeconds / SECONDS_PER_MINUTE))} min`);
  }

  if (session.totalVolumeKg !== null) {
    parts.push(`${formatSessionVolume(session.totalVolumeKg, unit)} ${unit}`);
  }

  return {
    // A completed session that logged nothing measurable. Stating the fact
    // rather than an empty line, so the row never looks broken.
    facts: parts.length === 0 ? 'No sets logged' : parts.join(' · '),
    records:
      session.personalRecordCount > 0
        ? `${String(session.personalRecordCount)} ${session.personalRecordCount === 1 ? 'PR' : 'PRs'}`
        : null,
  };
}

/**
 * A session total, in the reader's unit.
 *
 * `formatWeight` is the one place a stored kilogram becomes a displayed
 * number (`CLAUDE.md` §0 — conversion lives in `packages/utils` and
 * nowhere else). It renders a lift to one decimal, which is right for a
 * 62.5kg bar and three characters of noise on a four-figure session total,
 * so the trailing `.0` is stripped exactly as the client's own session
 * summary strips it — the two surfaces must not spell one session's volume
 * two ways.
 */
export function formatSessionVolume(volumeKg: number, unit: WeightUnit): string {
  return Number(formatWeight(volumeKg, unit)).toString();
}

/**
 * One sentence, so a coach scrolling a year of history with VoiceOver hears
 * a hundred sentences rather than six hundred fragments (`accessibility`
 * §2). The middot is spoken as a comma — a screen reader reads it aloud as
 * "dot" otherwise.
 */
export function buildRowLabel(
  date: string,
  name: string,
  meta: SessionMeta,
  needsReview: boolean,
): string {
  const spoken = meta.facts.replaceAll(' · ', ', ');
  const records = meta.records === null ? '' : `, ${meta.records}`;
  const review = needsReview ? ` ${NEEDS_REVIEW_LABEL}.` : '';
  return `${date}. ${name}. ${spoken}${records}.${review}`;
}

const styles = StyleSheet.create({
  // `minHeight` and a gap, never `height` — at 200% text the name and meta
  // lines grow and a fixed row would clip both (`accessibility` §3).
  row: { minHeight: SESSION_ROW_HEIGHT, paddingBottom: SESSION_ROW_GAP },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing(8) },
  spacer: { flex: 1 },
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(10),
    marginTop: DATE_NAME_GAP,
  },
  main: { flex: 1, minWidth: 0 },
  meta: { marginTop: NAME_META_GAP },
  tabular: { fontVariant: ['tabular-nums'] },
});

const useChevronColor = createThemedValue((t) => t.colors.fg.faint);
