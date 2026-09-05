import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { useTextScale } from '../theme/TextScaleProvider.tsx';
import { fontSize, type TextSize } from '../theme/tokens.ts';

// `DESIGN.md` §1.2 pins a FACE and a WEIGHT to every named size — there is
// no independent `weight` prop to get wrong. A component that sets
// `fontWeight` directly does nothing useful on Android, so every weight
// change here is a family change.
//
// Space Grotesk carries every numeral and heading; Instrument Sans carries
// body, labels, and buttons. Headings sit in Space Grotesk even though they
// are words — §1.2 is explicit that the split is heading/numeral vs
// everything else, not number vs word.
const SIZE_FONT_CLASS: Record<TextSize, string> = {
  display: 'font-display-bold',
  'numeral-xl': 'font-display-bold',
  stat: 'font-display-semibold',
  'h1-client': 'font-display-bold',
  h1: 'font-display-bold',
  h2: 'font-display-bold',
  numeral: 'font-display-semibold',
  title: 'font-sans-semibold',
  'body-lg': 'font-sans',
  body: 'font-sans',
  'body-sm': 'font-sans',
  label: 'font-sans-medium',
  caption: 'font-sans',
  micro: 'font-sans',
  eyebrow: 'font-sans-medium',
};

// §1.1's warm text ramp. `subtle` is legal at ≥14px only and `faint` may
// never carry meaning (§13) — both are stated here because the tone name is
// where a caller decides, and the rule is unenforceable at the type level.
const TONE_CLASS = {
  bright: 'text-fg-bright', // hero numerals only
  default: 'text-fg',
  glass: 'text-fg-glass', // body and icons ON a glass surface (§4)
  warm: 'text-fg-warm',
  'warm-muted': 'text-fg-warm-muted', // secondary text on glass
  muted: 'text-fg-muted',
  subtle: 'text-fg-subtle', // ≥14px only
  faint: 'text-fg-faint', // disabled, chevrons — never meaning
  onBrand: 'text-fg-onBrand', // dark ink on the peach primary fill
  urgent: 'text-urgent-text',
} as const;

export type TextTone = keyof typeof TONE_CLASS;

export type TextProps = RNTextProps & {
  size?: TextSize;
  tone?: TextTone;
  className?: string;
};

/**
 * The only text component the product uses — no component may set
 * `fontWeight`, and no component renders a raw React Native `Text`.
 * Defaults to `size="body"` (15pt) at `tone="default"`; a client-app screen
 * uses `body-lg` (16pt) for its body floor (`DESIGN.md` §1.3).
 *
 * Numbers do NOT go through this — they go through `Metric`, which pins
 * Space Grotesk and tabular numerals so figures never jitter (§1.2).
 */
export function Text({ size = 'body', tone = 'default', className, style, ...rest }: TextProps) {
  const classes = [`text-${size}`, SIZE_FONT_CLASS[size], TONE_CLASS[tone], className]
    .filter(Boolean)
    .join(' ');
  const scale = useTextScale();
  const scaled = scale === 1 ? undefined : scaleLineBox(size, scale);

  return <RNText className={classes} style={scaled ? [scaled, style] : style} {...rest} />;
}

// Only reached from the component gallery's text-scale toggle
// (`TextScaleProvider`); at scale 1 nothing is computed and the class
// name's own size and line height are what render.
function scaleLineBox(size: TextSize, scale: number): TextStyle {
  const [sizePx, { lineHeight }] = fontSize[size];
  return { fontSize: sizePx * scale, lineHeight: Number.parseFloat(lineHeight) * scale };
}
