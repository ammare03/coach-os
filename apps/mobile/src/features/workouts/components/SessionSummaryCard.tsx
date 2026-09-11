import { Card, Metric, Text } from '@coachos/ui';
import { createThemedStyles, radius, spacing, useTheme, withAlpha } from '@coachos/ui/theme';
import type { WeightUnit } from '@coachos/utils';
import { Triangle } from 'lucide-react-native';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  SUMMARY_COPY,
  buildRecordLines,
  formatSessionDuration,
  formatSessionVolume,
  formatSetsLogged,
  type SessionSummaryRead,
  type SummaryFigure,
} from '../lib/session-summary.ts';
import type { SessionRecord } from '../store/session-records-store.ts';

// `phase-09-workout-logger/session-summary/01` — §8.4's exact list: volume,
// duration, and PRs.
//
// Five decisions, in the order they matter:
//
// (a) **One card, three cells — not three stat tiles.** Volume, time and
//     sets are one sentence about one session, and three separate L2
//     surfaces at 393px put two borders between every pair of numbers. The
//     cells divide with a hairline, which is `DESIGN.md` §9's list-row rule
//     rather than its stat-tile rule, and it is the right one here because
//     the three figures are read together.
//
// (b) **A cell that cannot be computed is DROPPED.** Never a dash, never a
//     zero. A bodyweight session has no volume, and an ad-hoc session has
//     no plan to be a fraction of — `0 kg` reads as "you lifted nothing"
//     and `9 of 0` is simply false (`COPY.md` CO§2, and the rule
//     `TodayCard`'s `describeContext` already states for the same figures).
//
// (c) **Sets is here alongside §8.4's two.** The completed Today card
//     already states these same three figures for the same session
//     (`TodayCard`'s `StateGraphic`), and a summary that stated two of them
//     would leave the client comparing two surfaces that disagree about how
//     much of their session this screen thinks happened. It costs one cell
//     and one already-computed count.
//
// (d) **Every record, and every record worded by the pill's own rules.**
//     `buildRecordLines` calls `buildCelebration`, so heaviest-ever leads,
//     the exercise is always named, and the other types beaten collapse to
//     a `+N`. What changes is the surface, not the sentence: no `prpop`
//     overshoot, no brand glow, no dwell timer. `personal-records/03`
//     celebrated each of these once, at the moment it happened; this lists
//     them afterwards, and a second celebration would take the first one's
//     meaning away.
//
// (e) **The records section is absent when there are none.** Not an empty
//     state with a line about beating records next time — that is the
//     product forming a view about the client's session, which §10.1
//     forbids, and it would put a consolation prize on most screens.

const RECORD_GLYPH_SIZE = 16;

export interface SessionSummaryCardProps {
  summary: SessionSummaryRead;
  /** This session's ledger, in confirmation order — `useSessionRecordsStore`. */
  records: readonly SessionRecord[];
  /** Display only. The stored figures are kilograms, always (`CLAUDE.md` §0). */
  unit: WeightUnit;
}

export function SessionSummaryCard({ summary, records, unit }: SessionSummaryCardProps) {
  const themed = useThemedStyles();
  const figures = useMemo(() => {
    const cells: { key: string; label: string; figure: SummaryFigure }[] = [];
    // Decision (b) — each of the three is gated on being computable.
    if (summary.volumeKg !== null) {
      cells.push({
        key: 'volume',
        label: SUMMARY_COPY.volume,
        figure: formatSessionVolume(summary.volumeKg, unit),
      });
    }
    if (summary.durationSeconds !== null) {
      cells.push({
        key: 'time',
        label: SUMMARY_COPY.time,
        figure: formatSessionDuration(summary.durationSeconds),
      });
    }
    if (summary.setsLogged > 0 || summary.targetSets > 0) {
      cells.push({
        key: 'sets',
        label: SUMMARY_COPY.sets,
        figure: formatSetsLogged(summary.setsLogged, summary.targetSets),
      });
    }
    return cells;
  }, [summary, unit]);

  const lines = useMemo(
    () => buildRecordLines(records, summary.exerciseNames, unit),
    [records, summary.exerciseNames, unit],
  );

  return (
    <View style={styles.block}>
      {figures.length > 0 ? (
        <Card elevation="raised" density="client" testID="summary-figures">
          <View style={styles.figures}>
            {figures.map((cell, index) => (
              // One accessible item per cell: a stat carries its value AND
              // its unit, and the digits read alone say nothing
              // (`accessibility` §2).
              <View
                key={cell.key}
                style={[
                  styles.cell,
                  index === 0 ? styles.firstCell : null,
                  index === figures.length - 1 ? styles.lastCell : null,
                  index > 0 ? themed.divided : null,
                ]}
                accessible
                accessibilityLabel={cell.figure.label}
                testID={`summary-figure-${cell.key}`}
              >
                <Text size="eyebrow" tone="muted" style={styles.eyebrow}>
                  {cell.label}
                </Text>
                {/* Every standalone figure goes through `Metric` — Space
                    Grotesk and tabular numerals, with no prop to turn
                    either off. */}
                <Metric
                  value={cell.figure.value}
                  size="stat"
                  tone="bright"
                  {...(cell.figure.unit === undefined ? {} : { unit: cell.figure.unit })}
                />
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {lines.length > 0 ? (
        <View style={styles.section} testID="summary-records">
          <Text size="eyebrow" tone="muted" accessibilityRole="header" style={styles.heading}>
            {SUMMARY_COPY.records}
          </Text>
          {lines.map((line) => (
            <RecordRow key={line.setLocalId} line={line} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function RecordRow({ line }: { line: ReturnType<typeof buildRecordLines>[number] }) {
  const themed = useThemedStyles();
  const theme = useTheme();

  return (
    <View
      style={[styles.record, themed.record]}
      accessible
      accessibilityLabel={line.label}
      testID="summary-record"
    >
      {/* §8's record treatment, shape first: the same triangle the pill
          uses, so the mark survives greyscale and a client recognises the
          moment they already saw (`accessibility` §4). */}
      <Triangle
        size={RECORD_GLYPH_SIZE}
        color={theme.colors.brand.DEFAULT}
        fill={withAlpha(theme.colors.brand.DEFAULT, '0.25')}
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {/* Two nodes in a wrapping row: the words are Instrument Sans and the
          figure is Space Grotesk with tabular numerals, so a `102.5` cannot
          jitter against a `12`. */}
      <View style={styles.words}>
        <Text size="body">{line.lead}</Text>
        <Metric value={line.value} size="body" tone="warm" />
      </View>

      {line.moreCount > 0 ? (
        // Hidden from the reading order: `line.label` is the one utterance,
        // and "+2" spoken alone says nothing.
        <View
          style={[styles.more, themed.more]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text size="micro" tone="warm">
            {`+${String(line.moreCount)}`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing(20),
  },
  figures: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  cell: {
    flex: 1,
    minWidth: 0,
    gap: spacing(5),
    paddingHorizontal: spacing(12),
  },
  // The outer edges are the CARD's padding, not a second inset on top of it:
  // 18 + 12 would put a figure a third of a gutter in from its own border.
  firstCell: {
    paddingLeft: 0,
  },
  lastCell: {
    paddingRight: 0,
  },
  eyebrow: {
    textTransform: 'uppercase',
  },
  section: {
    gap: spacing(9),
  },
  heading: {
    textTransform: 'uppercase',
    paddingHorizontal: spacing(3),
  },
  record: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(11),
    paddingVertical: spacing(11),
    paddingHorizontal: spacing(13),
  },
  words: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: spacing(6),
    rowGap: spacing(3),
  },
  more: {
    flexShrink: 0,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing(3),
    paddingHorizontal: spacing(9),
  },
});

const useThemedStyles = createThemedStyles((theme) => ({
  /** The rule between two figures — a hairline inside one card, never a second card. */
  divided: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: theme.colors.border.soft,
  },
  record: {
    backgroundColor: withAlpha(theme.colors.deep, '0.3'),
    borderColor: withAlpha(theme.colors.brand.DEFAULT, '0.28'),
  },
  more: {
    backgroundColor: withAlpha(theme.colors.deep, '0.55'),
    borderColor: withAlpha(theme.colors.brand.DEFAULT, '0.28'),
  },
}));
