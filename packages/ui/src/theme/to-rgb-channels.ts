// Pure conversion, no colour literals of its own — `theme-tokens/02` keeps
// `tokens.ts` as the only file holding a value, this only holds logic.
// Tailwind's `<alpha-value>` modifier (`bg-brand/20`) requires the CSS
// variable to hold space-separated RGB channels, not a `#rrggbb` string.
export function hexToRgbChannels(hex: string): string {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  const digits = match?.[1];
  if (!digits) {
    throw new Error(`hexToRgbChannels: expected a 6-digit hex colour, got "${hex}"`);
  }
  const int = Number.parseInt(digits, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `${r} ${g} ${b}`;
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
