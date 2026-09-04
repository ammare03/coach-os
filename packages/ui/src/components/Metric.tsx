import { View } from 'react-native';

import type { TextSize } from '../theme/tokens.ts';

import { Text } from './Text.tsx';

// Numerals are always Space Grotesk (`DESIGN.md` §1.2), independent of
// `Text`'s per-size default — this is the whole reason `Metric` exists
// rather than callers reaching for `Text` on a number.
const SIZE_FONT_CLASS: Record<TextSize, string> = {
  display: 'font-display-bold',
  'numeral-xl': 'font-display-bold',
  stat: 'font-display-semibold',
  'h1-client': 'font-display-bold',
  h1: 'font-display-bold',
  h2: 'font-display-bold',
  numeral: 'font-display-semibold',
  title: 'font-display-semibold',
  'body-lg': 'font-display',
  body: 'font-display',
  'body-sm': 'font-display',
  label: 'font-display',
  caption: 'font-display',
  micro: 'font-display',
  eyebrow: 'font-display',
};

// Largest to smallest — `unit` renders one step down from `size`, so "60kg"
// and "60 kg" are not re-decided by each consumer.
const SCALE_ORDER: TextSize[] = [
  'display',
  'numeral-xl',
  'stat',
  'h1-client',
  'h1',
  'h2',
  'title',
  'body-lg',
  'numeral',
  'body',
  'label',
  'body-sm',
  'caption',
  'micro',
  'eyebrow',
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
  /** §1.1 — `bright` is hero numerals only; everything else uses the default. */
  tone?: 'bright' | 'default' | 'warm' | 'glass' | 'muted';
  className?: string;
  testID?: string;
};

/**
 * Renders a number. Space Grotesk, tabular numerals, always — there is no
 * prop to turn either off (`DESIGN.md` §1.2: "on **every** number, without
 * exception — figures must not jitter when a timer ticks or a set is
 * logged"). Weights, reps, calories, timers, adherence counts, macro grams,
 * durations, and badge counts all go through this, never through `Text`.
 */
export function Metric({
  value,
  unit,
  size = 'stat',
  tone = 'default',
  className,
  testID,
}: MetricProps) {
  return (
    <View testID={testID} className="flex-row items-baseline gap-4">
      <Text
        size={size}
        tone={tone}
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
