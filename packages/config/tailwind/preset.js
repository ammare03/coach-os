// Shared Tailwind preset — the vocabulary `apps/mobile` (NativeWind) and,
// later, `apps/web` both compile against (`CLAUDE.md` §3.1). Holds no
// colour, radius, or spacing value of its own; everything here is read from
// `packages/ui/src/theme/tokens.ts`, the single source of truth
// (`theme-tokens/02`).
//
// Colours resolve through a CSS-variable indirection
// (`rgb(var(--color-x) / <alpha-value>)`) rather than the literal hex, so
// `theme-tokens/04`'s dark/light switch and P25's white-label override can
// change what a variable holds without this preset — or any component —
// changing at all.
const { colors, radius, spacing, spacingSteps } = require('../../ui/src/theme/tokens.ts');
const { flattenColorChannels } = require('../../ui/src/theme/to-rgb-channels.ts');

const channelNames = Object.keys(flattenColorChannels(colors));

/** `{ 'bg-raised': 'rgb(var(--color-bg-raised) / <alpha-value>)', ... }` */
const cssVarColors = Object.fromEntries(
  channelNames.map((name) => [name, `rgb(var(--color-${name}) / <alpha-value>)`]),
);

// Un-flatten `bg-raised` → `{ bg: { raised: '...' } }` so Tailwind produces
// `bg-bg-raised`, `text-fg-muted`, etc. — the semantic names tasks 03-05 and
// every downstream component write.
function nest(flat) {
  const out = {};
  for (const [key, value] of Object.entries(flat)) {
    const [group, ...rest] = key.split('-');
    if (rest.length === 0) {
      out[group] = value;
      continue;
    }
    out[group] = out[group] ?? {};
    out[group][rest.join('-')] = value;
  }
  return out;
}

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    // Replaced wholesale, not extended — Tailwind's defaults (blue-600,
    // p-2.5, rounded-2xl…) must not be reachable (theme-tokens/02 approach §3, §5).
    colors: nest(cssVarColors),
    borderRadius: radius,
    spacing: Object.fromEntries(spacingSteps.map((step) => [step, `${spacing(step)}px`])),
    extend: {},
  },
  plugins: [],
};
