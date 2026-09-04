import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import type { TextSize } from '../theme/tokens.ts';

// DS§3.1 pins a face AND a weight to every named size — there is no
// independent `weight` prop to get wrong (theme-tokens/03). A component
// that sets `fontWeight` directly does nothing useful on Android
// (theme-tokens/03 risks); every weight change here is a family change.
const SIZE_FONT_CLASS: Record<TextSize, string> = {
  display: 'font-display-bold',
  hero: 'font-display-bold',
  metric: 'font-display-semibold',
  'metric-sm': 'font-display-semibold',
  title: 'font-sans-semibold',
  heading: 'font-sans-semibold',
  body: 'font-sans',
  'body-sm': 'font-sans',
  label: 'font-sans-medium',
  caption: 'font-sans',
};

const TONE_CLASS = {
  default: 'text-fg',
  muted: 'text-fg-muted',
  subtle: 'text-fg-subtle',
} as const;

export type TextTone = keyof typeof TONE_CLASS;

export type TextProps = RNTextProps & {
  size?: TextSize;
  tone?: TextTone;
  className?: string;
};

/**
 * The only text component the product uses (`ui-conventions` — no
 * component may set `fontWeight`). Defaults to `size="body"` (16pt), the
 * client-app floor (`CLAUDE.md` §7.1), so the lazy choice is the correct
 * one.
 */
export function Text({ size = 'body', tone = 'default', className, ...rest }: TextProps) {
  const classes = [`text-${size}`, SIZE_FONT_CLASS[size], TONE_CLASS[tone], className]
    .filter(Boolean)
    .join(' ');

  return <RNText className={classes} {...rest} />;
}
