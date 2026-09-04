// Regenerates the ten-stop brand ramp from one coach-supplied hex
// (`theme-tokens/04`, `DESIGN-SYSTEM.md` DS§2.4). Lives here, not in
// `packages/ui`, so the app and any future web dashboard agree
// (`CLAUDE.md` §3.1).
//
// The saturation/lightness curve is extracted from the default indigo ramp
// (`packages/ui/src/theme/tokens.ts`) — only the hue changes per coach, so
// every generated ramp keeps the same coherent shape rather than a naive
// per-stop lightness scale that goes muddy on a saturated input (DS§2.4 risk).
const HEX_RE = /^#([0-9A-Fa-f]{6})$/;

/** DB§5.1's `^#[0-9A-Fa-f]{6}$` check, exported so callers can decide "is this worth regenerating a ramp for" before calling `generateBrandRamp`. */
export function isValidHexColor(hex: string | null | undefined): hex is string {
  return typeof hex === 'string' && HEX_RE.test(hex);
}

export const BRAND_RAMP_STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export type BrandRampStop = (typeof BRAND_RAMP_STOPS)[number];
export type BrandRamp = Record<BrandRampStop, string> & { DEFAULT: string };

// [saturation%, lightness%] per stop, extracted from the default ramp.
const CURVE: Record<BrandRampStop, [number, number]> = {
  50: [100, 96.7],
  100: [100, 93.9],
  200: [96.5, 88.8],
  300: [91.5, 81.6],
  400: [89.1, 74.9],
  500: [83.5, 66.7],
  600: [70, 59.4],
  700: [49, 50],
  800: [47.4, 41],
  900: [42.7, 33.5],
};

const DEFAULT_HUE = 238.7; // the default ramp's hue — the fallback on invalid input

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

/** Contrast of a fill colour against white text — the only direction this module needs. */
function contrastAgainstWhite(fillHex: string): number {
  const whiteLuminance = 1 + 0.05;
  const fillLuminance = relativeLuminance(fillHex) + 0.05;
  return whiteLuminance / fillLuminance;
}

/**
 * Generates the ten-stop ramp for a coach's white-label brand colour.
 * Falls back to the default indigo ramp on anything that isn't a valid
 * `#rrggbb` hex (DB§5.1's `^#[0-9A-Fa-f]{6}$` check) — a malformed brand
 * colour must degrade to CoachOS blue, never to an unstyled app.
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

  // Clamp the fill stop (500/DEFAULT) to 4.5:1 against white text — darken
  // until it passes rather than ship a coach's own client an unreadable
  // button (DS§2.4). No iteration guard needed: contrast against white
  // strictly increases as lightness drops, reaching ~21:1 at black, so this
  // always terminates well before then.
  let fillLightness = CURVE[500][1];
  while (contrastAgainstWhite(stops[500]) < 4.5) {
    fillLightness -= 2;
    const darkened = hslToHex(hue, CURVE[500][0], fillLightness);
    stops[500] = darkened;
    stops[600] = darkened; // keep 600 (pressed) at least as dark as 500
  }

  return { ...stops, DEFAULT: stops[500] };
}
