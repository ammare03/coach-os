// WCAG 2.2 contrast maths, for the token audit in `contrast-audit.test.ts`.
// Pure arithmetic with no colour literals of its own — `tokens.ts` stays the
// only file in the package holding a value.
//
// The full piecewise sRGB transfer function, not the ^2.4-only shortcut in
// `@coachos/utils`' `brand-ramp.ts`. That one is deliberately simplified
// because every colour it ever sees sits above 25% lightness; this one is
// pointed at the whole palette, including `bg.outer` (#0E141F), whose blue
// channel lands inside the linear segment where the shortcut drifts.
//
// Alpha matters here. Half the surfaces in `tokens.ts` are `rgba(...)` over
// something else (`control.surface`, `dataviz.barTrack`, every glass tier),
// and contrast is undefined for a translucent colour — it has to be
// composited over a stated backdrop first. `resolveLayers` is that step, and
// it is why every translucent entry in the audit names what it sits on.

export type Rgb = readonly [number, number, number];

const HEX = /^#([0-9a-fA-F]{6})$/;
const RGBA = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/;

export type ParsedColor = { rgb: Rgb; alpha: number };

/** Parses `#rrggbb`, `rgb(r,g,b)`, and `rgba(r,g,b,a)`. Throws on anything else. */
export function parseColor(value: string): ParsedColor {
  const hex = HEX.exec(value);
  if (hex?.[1]) {
    const int = Number.parseInt(hex[1], 16);
    return { rgb: [(int >> 16) & 255, (int >> 8) & 255, int & 255], alpha: 1 };
  }
  const rgba = RGBA.exec(value.trim());
  if (rgba?.[1] && rgba[2] && rgba[3]) {
    return {
      rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])],
      alpha: rgba[4] === undefined ? 1 : Number(rgba[4]),
    };
  }
  throw new Error(`parseColor: expected a hex or rgb(a) colour, got "${value}"`);
}

/** Source-over composite of `fg` at `alpha` onto an already-opaque `bg`. */
export function compositeOver(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return [
    fg[0] * alpha + bg[0] * (1 - alpha),
    fg[1] * alpha + bg[1] * (1 - alpha),
    fg[2] * alpha + bg[2] * (1 - alpha),
  ];
}

/**
 * Flattens a stack of colours, bottom first, into one opaque colour. The
 * first entry must be opaque — there is nothing behind it to composite
 * against, and silently assuming black is how a "passing" ratio gets
 * invented for a surface nobody ever renders.
 */
export function resolveLayers(layers: readonly string[]): Rgb {
  const [first, ...rest] = layers;
  if (first === undefined) throw new Error('resolveLayers: needs at least one layer');
  const base = parseColor(first);
  if (base.alpha !== 1) {
    throw new Error(`resolveLayers: the bottom layer must be opaque, got "${first}"`);
  }
  return rest.reduce<Rgb>((below, layer) => {
    const { rgb, alpha } = parseColor(layer);
    return compositeOver(rgb, alpha, below);
  }, base.rgb);
}

/** WCAG 2.2 relative luminance (§ "relative luminance"), full piecewise form. */
export function relativeLuminance(rgb: Rgb): number {
  const linear = (channel: number) => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

/** WCAG 2.2 contrast ratio, 1–21. Order-independent. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Contrast between two colour STACKS, each given bottom-first. The common
 * case is a one-entry foreground over a multi-entry background, e.g.
 * `ratioOf(['#FDF3EF'], ['#161E2F', 'rgba(255,229,218,0.18)'])`.
 */
export function ratioOf(foreground: readonly string[], background: readonly string[]): number {
  const [first] = foreground;
  if (first === undefined) throw new Error('ratioOf: needs at least one foreground layer');
  const bg = resolveLayers(background);
  // A translucent foreground (a hairline, a dimmed glyph) is judged where it
  // actually lands — composited onto the background it sits on, not assumed
  // to be opaque.
  const fg =
    parseColor(first).alpha === 1
      ? resolveLayers(foreground)
      : resolveLayers([...background, ...foreground]);
  return contrastRatio(fg, bg);
}

/** Rounded to 2dp — the form the audit records, so a table diff is readable. */
export function round2(ratio: number): number {
  return Math.round(ratio * 100) / 100;
}
