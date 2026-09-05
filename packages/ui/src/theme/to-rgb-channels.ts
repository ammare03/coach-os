// Pure conversion, no colour literals of its own — `theme-tokens/02` keeps
// `tokens.ts` as the only file holding a value, this only holds logic.
// Tailwind's `<alpha-value>` modifier (`bg-brand/20`) requires the CSS
// variable to hold space-separated RGB channels, not a `#rrggbb` string.
function parseHex(hex: string, caller: string): [number, number, number] {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  const digits = match?.[1];
  if (!digits) {
    throw new Error(`${caller}: expected a 6-digit hex colour, got "${hex}"`);
  }
  const int = Number.parseInt(digits, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

export function hexToRgbChannels(hex: string): string {
  const [r, g, b] = parseHex(hex, 'hexToRgbChannels');
  return `${r} ${g} ${b}`;
}

/**
 * `#131A29` + `'0.5'` -> `rgba(19,26,41,0.5)`.
 *
 * `alpha` is a STRING, not a number, and that is deliberate: `DESIGN.md`
 * writes some alphas to one decimal (`.5`) and some to two (`.30`), and a
 * numeric parameter would collapse `0.30` to `0.3` — a different string for
 * the same colour, which is exactly the kind of silent diff this file's
 * consumers (a per-scheme derivation over a dark table that must not move)
 * cannot afford.
 */
export function withAlpha(hex: string, alpha: string): string {
  if (!/^(0|1|0?\.\d+)$/.test(alpha)) {
    throw new Error(`withAlpha: expected an alpha between 0 and 1 as a string, got "${alpha}"`);
  }
  const [r, g, b] = parseHex(hex, 'withAlpha');
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Walks a token colour object (possibly nested one level, e.g. `bg.raised`) into `{ 'bg-raised': '18 22 29', ... }`. */
export function flattenColorChannels(
  colors: Record<string, string | Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(colors)) {
    if (typeof value === 'string') {
      out[key] = hexToRgbChannels(value);
    } else {
      for (const [subKey, subValue] of Object.entries(value)) {
        out[`${key}-${subKey}`] = hexToRgbChannels(subValue);
      }
    }
  }
  return out;
}
