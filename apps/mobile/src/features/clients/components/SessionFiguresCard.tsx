import { Card, Metric, Text } from '@coachos/ui';
import { createThemedValue, spacing } from '@coachos/ui/theme';
import type { WeightUnit } from '@coachos/utils';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import type { SessionReview } from '../api.ts';

import { formatSessionVolume } from './SessionHistoryRow.tsx';

// `session-review/01` — what the session came to, in one L2 card with
// hairline-divided cells.
//
// **One card, not three tiles.** Three separate tiles put two borders
// between every pair of numbers, and duration, volume and exertion are one
// sentence about one session, not three unrelated facts.
//
// **A figure that cannot be computed is ABSENT.** The cell is removed and
// the survivors redistribute — never a `0`, never a dash, never a greyed
// placeholder. A zero volume is a claim about a bodyweight session that is
// simply false, and a dash makes a screen reader announce a cell with
// nothing in it (`COPY.md` CO§2). A session that logged nothing has no
// settled total at all, so the whole card is absent.

const SECONDS_PER_MINUTE = 60;

/**
 * Past this OS font scale the three columns stop fitting side by side and
 * stack instead — the design's 200%-text frame, implemented against
 * `useWindowDimensions().fontScale` because it is the one reactive reading
 * of the OS setting React Native exposes.
 *
 * 1.5 rather than 2.0: the collision starts well before 200%, and a coach
 * at 150% should meet the layout that fits rather than the one that just
 * about does not.
 */
const STACK_FONT_SCALE = 1.5;

export const SESSION_FIGURES_COPY = {
  volume: 'Volume',
  time: 'Time',
  sets: 'Sets',
  exertion: 'RPE',
  /** Opens the card's one spoken sentence. */
  spokenLead: 'Session totals',
} as const;

/** One cell: what it is called, what it shows, and what it says out loud. */
export interface SessionFigure {
  key: string;
  label: string;
  value: string;
  unit?: string;
  spoken: string;
}

/**
 * The figures this session actually has, in reading order.
 *
 * `Sets` stands in for `Volume` rather than beside it: a bodyweight session
 * has no volume to state, and the count is the honest figure that is left.
 * A session with a volume never shows both — the count is already implicit
 * in the rows below.
 *
 * Returns `[]` for a session with nothing logged, and the caller renders no
 * card at all. There is no "0 kg, 0 min, 0 sets" state, by construction.
 */
export function sessionFigures(
  session: Pick<SessionReview, 'totalVolumeKg' | 'durationSeconds' | 'perceivedExertion'>,
  setCount: number,
  unit: WeightUnit,
): SessionFigure[] {
  if (setCount === 0) return [];

  const figures: SessionFigure[] = [];

  if (session.totalVolumeKg !== null) {
    const value = formatSessionVolume(session.totalVolumeKg, unit);
    figures.push({
      key: 'volume',
      label: SESSION_FIGURES_COPY.volume,
      value,
      unit,
      spoken: `${SESSION_FIGURES_COPY.volume}, ${value} ${unit === 'kg' ? 'kilograms' : 'pounds'}.`,
    });
  }

  if (session.durationSeconds !== null) {
    const minutes = String(Math.round(session.durationSeconds / SECONDS_PER_MINUTE));
    figures.push({
      key: 'time',
      label: SESSION_FIGURES_COPY.time,
      value: minutes,
      unit: 'min',
      spoken: `${SESSION_FIGURES_COPY.time}, ${minutes} minutes.`,
    });
  }

  if (session.totalVolumeKg === null) {
    figures.push({
      key: 'sets',
      label: SESSION_FIGURES_COPY.sets,
      value: String(setCount),
      spoken: `${SESSION_FIGURES_COPY.sets}, ${String(setCount)}.`,
    });
  }

  if (session.perceivedExertion !== null) {
    const rating = String(session.perceivedExertion);
    figures.push({
      key: 'exertion',
      label: SESSION_FIGURES_COPY.exertion,
      value: rating,
      spoken: `${SESSION_FIGURES_COPY.exertion}, ${rating}.`,
    });
  }

  return figures;
}

export interface SessionFiguresCardProps {
  figures: SessionFigure[];
  testID?: string;
}

export function SessionFiguresCard({ figures, testID }: SessionFiguresCardProps) {
  const divider = useDividerColor();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= STACK_FONT_SCALE;

  if (figures.length === 0) return null;

  return (
    <Card elevation="raised" density="coach" padded={false} testID={testID ?? 'session-figures'}>
      {/* One accessible element, one sentence — three separately focusable
          numbers would be three stops for one fact (`accessibility` §2). */}
      <View
        style={[styles.cells, stacked ? styles.cellsStacked : null]}
        accessible
        accessibilityLabel={speakFigures(figures)}
      >
        {figures.map((figure, index) => (
          <View
            key={figure.key}
            style={[
              styles.cell,
              stacked ? styles.cellStacked : null,
              index === 0
                ? null
                : stacked
                  ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: divider }
                  : { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: divider },
            ]}
          >
            <Text size="eyebrow" tone="muted">
              {figure.label.toUpperCase()}
            </Text>
            <Metric
              value={figure.value}
              {...(figure.unit === undefined ? {} : { unit: figure.unit })}
              size="stat"
              tone="bright"
            />
          </View>
        ))}
      </View>
    </Card>
  );
}

/** `Session totals. Volume, 7,240 kilograms. Time, 48 minutes. RPE, 8.` */
export function speakFigures(figures: SessionFigure[]): string {
  return [`${SESSION_FIGURES_COPY.spokenLead}.`, ...figures.map((f) => f.spoken)].join(' ');
}

const styles = StyleSheet.create({
  cells: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: spacing(16),
    paddingHorizontal: spacing(6),
  },
  cellsStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
    paddingHorizontal: spacing(14),
  },
  cell: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: spacing(12),
    gap: spacing(5),
  },
  cellStacked: {
    flex: 0,
    paddingHorizontal: 0,
    marginTop: spacing(12),
    paddingTop: spacing(12),
  },
});

const useDividerColor = createThemedValue((t) => t.colors.border.soft);
