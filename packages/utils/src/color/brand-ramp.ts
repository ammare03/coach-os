// Regenerates the five-stop warm brand ramp from one coach-supplied hex
// (`DESIGN.md` §1.1, white-label per `CLAUDE.md` §15.2). Lives here, not in
// `packages/ui`, so the app and any future web dashboard agree
// (`CLAUDE.md` §3.1).
//
// The saturation/lightness curve is extracted from the default ember-peach
// ramp (`packages/ui/src/theme/tokens.ts`) — only the hue changes per coach,
// so every generated ramp keeps the same coherent shape rather than a naive
// per-stop lightness scale that goes muddy on a saturated input.
//
// The ramp is five NAMED stops, not ten numeric ones: `DESIGN.md` §1.1 gives
// the accent plus two interpolated mid-tones because "the palette's single
// accent cannot carry a multi-series chart". A ten-stop Tailwind-shaped ramp
// would be four stops nobody uses and two the charts would have to guess at.
const HEX_RE = /^#([0-9A-Fa-f]{6})$/;

/** DB§5.1's `^#[0-9A-Fa-f]{6}$` check, exported so callers can decide "is this worth regenerating a ramp for" before calling `generateBrandRamp`. */
export function isValidHexColor(hex: string | null | undefined): hex is string {
  return typeof hex === 'string' && HEX_RE.test(hex);
}

// `DEFAULT` is the accent itself; `lift` is the brightest data point,
// `mid`/`deep` the second and third chart series, `shade` the border on
// dimmed and partial states (`DESIGN.md` §1.1).
export const BRAND_RAMP_STOPS = ['lift', 'DEFAULT', 'mid', 'deep', 'shade'] as const;
export type BrandRampStop = (typeof BRAND_RAMP_STOPS)[number];
export type BrandRamp = Record<BrandRampStop, string>;

// [saturation%, lightness%] per stop, extracted from the default ramp.
const CURVE: Record<BrandRampStop, [number, number]> = {
  lift: [100, 82.9],
  DEFAULT: [100, 76.3],
  mid: [67.5, 62.5],
  deep: [48, 49],
  shade: [40.6, 39.6],
};

const DEFAULT_HUE = 15.4; // the default ramp's hue — the fallback on invalid input

function hexToHue(hex: string): number {
  const int = Number.parseInt(hex.slice(1), 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

function hslToHex(h: number, s: number, l: number): string {
  const sFrac = s / 100;
  const lFrac = l / 100;
  const c = (1 - Math.abs(2 * lFrac - 1)) * sFrac;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lFrac - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toByte = (channel: number) =>
    Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`.toUpperCase();
}

// WCAG relative luminance, simplified: the piecewise near-black linear
// segment of the full formula never applies here — every stop this module
// produces sits at ≥25% lightness (theme-tokens/04's brand curve floor), so
// the ^2.4 gamma term alone matches the full formula within a fraction of a
// percent for the range of colours this function ever actually receives.
function relativeLuminance(hex: string): number {
  const int = Number.parseInt(hex.slice(1), 16);
  const gamma = (channel: number) => ((channel / 255 + 0.055) / 1.055) ** 2.4;
  const r = gamma((int >> 16) & 255);
  const g = gamma((int >> 8) & 255);
  const b = gamma(int & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// `DESIGN.md` §1.1 inverts the primary fill: a light peach surface carries
// DARK ink (`colors.fg.onBrand`, #161E2F), which reads 8.4:1 — never the
// #FFA586-under-white pairing §1.1 calls out as failing at 2.6:1.
// Duplicated as a literal rather than imported: `packages/utils` may not
// depend on `packages/ui` (`CLAUDE.md` §4).
const ON_BRAND_INK = '#161E2F';

/**
 * Contrast of a fill colour against the dark on-brand ink — the only
 * direction this module needs.
 *
 * The previous ramp *clamped* its fill stop with this, darkening until it
 * cleared 4.5:1 against white. Inverting the ink made that loop dead code:
 * `CURVE.DEFAULT` pins lightness at 76.3%, and the worst case across all
 * 360 hues at that lightness is **5.45:1** (hue 240, pure blue). The floor
 * is structural, not conditional, so the clamp was removed rather than kept
 * as an unreachable branch — `brand-ramp.test.ts` asserts the invariant
 * across the whole hue circle instead, which is what the clamp was really
 * protecting. If `CURVE` is ever re-cut darker, that test fails first.
 */
export function contrastAgainstInk(fillHex: string): number {
  const fillLuminance = relativeLuminance(fillHex) + 0.05;
  const inkLuminance = relativeLuminance(ON_BRAND_INK) + 0.05;
  return fillLuminance / inkLuminance;
}

/**
 * Generates the five-stop warm ramp for a coach's white-label brand colour.
 * Falls back to the default ember-peach ramp on anything that isn't a valid
 * `#rrggbb` hex (DB§5.1's `^#[0-9A-Fa-f]{6}$` check) — a malformed brand
 * colour must degrade to the CoachOS accent, never to an unstyled app.
 */
export function generateBrandRamp(inputHex: string | null | undefined): BrandRamp {
  // Rounded to 1dp so the same hex always yields the same hue regardless of
  // floating-point path — otherwise `generateBrandRamp(defaultHex)` and the
  // hardcoded `DEFAULT_HUE` fallback could disagree by a rounding hair.
  const hue = Math.round((isValidHexColor(inputHex) ? hexToHue(inputHex) : DEFAULT_HUE) * 10) / 10;

  const stops = Object.fromEntries(
    BRAND_RAMP_STOPS.map((stop) => {
      const curve = CURVE[stop];
      return [stop, hslToHex(hue, curve[0], curve[1])];
    }),
  ) as Record<BrandRampStop, string>;

  // No contrast clamp — see `contrastAgainstInk`. The curve's fixed
  // lightness already guarantees the fill clears 4.5:1 against the ink for
  // every hue a coach can supply, so there is nothing left to correct.
  return stops;
}
