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
//
// The two requires below cross a workspace boundary by relative path, which
// `import/no-relative-packages` exists to stop. `@coachos/ui` would be the
// correct specifier and cannot be used: `packages/ui` extends
// `@coachos/config` — its tailwind.config.js, eslint.config.js and
// tsconfig.json all resolve through this package — so a package-specifier
// import here would close a config↔ui cycle. Note that the rule's autofix
// WILL rewrite these to `@coachos/ui/...` if the directives below are ever
// detached from them, and `.lintstagedrc.json` runs `eslint --fix`. The
// resolution is to move the token source into a package both can depend on,
// which is an ownership decision rather than a lint fix: UNFORGET A20.
/* eslint-disable import/no-relative-packages -- see above; UNFORGET A20. */
const { flattenColorChannels } = require('../../ui/src/theme/to-rgb-channels.ts');
const {
  colors,
  radius,
  spacingSteps,
  fontFamily,
  fontSize,
} = require('../../ui/src/theme/tokens.ts');
/* eslint-enable import/no-relative-packages */

const channelNames = Object.keys(flattenColorChannels(colors));

/** `{ 'bg-raised': 'rgb(var(--color-bg-raised) / <alpha-value>)', ... }` */
const cssVarColors = Object.fromEntries(
  channelNames.map((name) => [name, `rgb(var(--color-${name}) / <alpha-value>)`]),
);

// Un-flatten `bg-raised` → `{ bg: { raised: '...' } }` so Tailwind produces
// `bg-bg-raised`, `text-fg-muted`, etc. — the semantic names tasks 03-05 and
// every downstream component write.
//
// A group that has BOTH a bare key and a hyphenated sibling (`urgent` and
// `urgent-text`) collapses to Tailwind's `DEFAULT`, so both classes survive.
// Without it the bare value lands as a string and the sibling's assignment
// onto a string primitive is a silent no-op — `text-urgent-text` is simply
// never generated, and NativeWind drops the unknown class without erroring.
// Order-independent on purpose: `flattenColorChannels` decides which arrives
// first, and neither ordering may lose a value.
/**
 * @param {Record<string, string>} flat
 * @returns {Record<string, string | Record<string, string>>}
 */
function nest(flat) {
  /** @type {Record<string, string | Record<string, string>>} */
  const out = {};
  for (const [key, value] of Object.entries(flat)) {
    // `split` always yields at least one segment, so the default never
    // fires — it is there so the checker can see `group` as a string.
    const [group = key, ...rest] = key.split('-');
    const existing = out[group];
    if (rest.length === 0) {
      if (typeof existing === 'object') existing.DEFAULT = value;
      else out[group] = value;
      continue;
    }
    const nested = typeof existing === 'string' ? { DEFAULT: existing } : (existing ?? {});
    nested[rest.join('-')] = value;
    out[group] = nested;
  }
  return out;
}

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    // Replaced wholesale, not extended — Tailwind's defaults (blue-600,
    // p-2.5, rounded-2xl…) must not be reachable (theme-tokens/02 approach §3, §5).
    colors: nest(cssVarColors),
    borderRadius: Object.fromEntries(
      Object.entries(radius).map(([name, value]) => [name, `${value}px`]),
    ),
    // `DESIGN.md` §1.4's 1px scale — the step IS the pixel value, so `p-14`
    // is 14px. A step outside the closed set simply does not exist as a
    // class, which is the constraint.
    spacing: Object.fromEntries(spacingSteps.map((step) => [step, `${step}px`])),
    // Both overridden wholesale (theme-tokens/03 approach §4) — Tailwind's
    // `font-bold`/`text-3xl` and the rest of its defaults must not exist.
    fontFamily,
    fontSize,
    extend: {},
  },
  plugins: [],
};
