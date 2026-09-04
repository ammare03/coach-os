import { View } from 'react-native';

import type { TextSize } from '../theme/tokens.ts';

import { Text } from './Text.tsx';

// Numerals are always Inter Tight (DS§3.1), independent of `Text`'s
// per-size Inter default — this is the whole reason `Metric` exists rather
// than callers reaching for `Text` on a number (theme-tokens/03).
const SIZE_FONT_CLASS: Record<TextSize, string> = {
  display: 'font-display-bold',
  hero: 'font-display-bold',
  metric: 'font-display-semibold',
  'metric-sm': 'font-display-semibold',
  title: 'font-display',
  heading: 'font-display',
  body: 'font-display',
  'body-sm': 'font-display',
  label: 'font-display',
  caption: 'font-display',
};

// Largest to smallest — `unit` renders one step down from `size`
// (theme-tokens/03 interfaces: "60kg and 60 kg must not be re-decided by
// each consumer").
const SCALE_ORDER: TextSize[] = [
  'display',
  'hero',
  'metric',
  'metric-sm',
  'title',
  'heading',
  'body',
  'body-sm',
  'label',
  'caption',
];

function stepDown(size: TextSize): TextSize {
  const index = SCALE_ORDER.indexOf(size);
  return SCALE_ORDER[Math.min(index + 1, SCALE_ORDER.length - 1)] ?? size;
}

export type MetricProps = {
  /** Already formatted for display — `Metric` does not format, round, or convert (`CLAUDE.md` §17.2). */
  value: string | number;
  unit?: string;
  size?: TextSize;
  className?: string;
  testID?: string;
};

/**
 * Renders a number. Inter Tight, tabular numerals, always — there is no
 * prop to turn either off (theme-tokens/03). Weights, reps, calories,
 * timers, adherence percentages, macro grams, and durations all go through
 * this, never through `Text`.
 */
export function Metric({ value, unit, size = 'metric', className, testID }: MetricProps) {
  return (
    <View testID={testID} className="flex-row items-baseline gap-1">
      <Text
        size={size}
        className={[SIZE_FONT_CLASS[size], className].filter(Boolean).join(' ')}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {value}
      </Text>
      {unit ? (
        <Text size={stepDown(size)} tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
          {unit}
        </Text>
      ) : null}
    </View>
  );
}
