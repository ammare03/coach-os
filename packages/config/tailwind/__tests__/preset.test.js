// The guard that was missing when `nest()` silently dropped `urgent-text`
// (pre-phase-09 audit, finding Q9). Nothing anywhere exercised the compiled
// preset — `Text.test.tsx` asserts the class *string* `text-urgent-text`,
// which is applied whether or not Tailwind can generate it, and NativeWind
// drops an unknown class without erroring. So the defect was invisible from
// both ends.
//
// The loop in the first test is the real guard; the named cases below it are
// documentation of the collision that motivated it.
const preset = require('../preset.js');
const { colors: tokenColors } = require('../../../ui/src/theme/tokens.ts');
const { flattenColorChannels } = require('../../../ui/src/theme/to-rgb-channels.ts');

const { colors } = preset.theme;

/** `'urgent-text'` → `colors.urgent.text`; `'urgent'` → `colors.urgent.DEFAULT`. */
function resolveChannel(flatKey) {
  const [group, ...rest] = flatKey.split('-');
  const node = colors[group];
  if (rest.length === 0) {
    return typeof node === 'string' ? node : node?.DEFAULT;
  }
  return typeof node === 'string' ? undefined : node?.[rest.join('-')];
}

describe('tailwind preset — every colour token survives nesting', () => {
  const flatKeys = Object.keys(flattenColorChannels(tokenColors));

  it('has a channel to flatten', () => {
    expect(flatKeys.length).toBeGreaterThan(0);
  });

  // The invariant, not the instance: any future token whose name collides
  // with another's prefix fails here rather than vanishing.
  it.each(flatKeys)('%s is reachable in the nested output', (flatKey) => {
    expect(resolveChannel(flatKey)).toBe(`rgb(var(--color-${flatKey}) / <alpha-value>)`);
  });

  it('loses no token — nested leaf count matches the flat key count', () => {
    const leaves = Object.values(colors).flatMap((group) =>
      typeof group === 'string' ? [group] : Object.values(group),
    );
    expect(leaves).toHaveLength(flatKeys.length);
  });
});

describe('tailwind preset — the urgent/urgent-text collision (Q9)', () => {
  // `tokens.ts` declares a bare `urgent` AND an `urgent-text`. Splitting on
  // the first hyphen put a string at `colors.urgent`, and the sibling's
  // assignment onto a string primitive was a silent no-op.
  it('keeps both, with the bare value under DEFAULT', () => {
    expect(colors.urgent.DEFAULT).toBe('rgb(var(--color-urgent) / <alpha-value>)');
    expect(colors.urgent.text).toBe('rgb(var(--color-urgent-text) / <alpha-value>)');
  });

  it('still generates text-urgent as well as text-urgent-text', () => {
    // Tailwind emits the bare utility name from `DEFAULT`, so promoting the
    // string did not cost the `text-urgent` class.
    expect(typeof colors.urgent.DEFAULT).toBe('string');
  });

  it('leaves a group with no bare sibling nested as before', () => {
    // `on-deep` has no bare `on`, so it must stay a plain nested key.
    expect(colors.on.deep).toBe('rgb(var(--color-on-deep) / <alpha-value>)');
    expect(colors.on.DEFAULT).toBeUndefined();
    expect(colors.bg.raised).toBe('rgb(var(--color-bg-raised) / <alpha-value>)');
  });
});

describe('tailwind preset — the rest of the theme is replaced, not extended', () => {
  // theme-tokens/02 §3, §5: Tailwind's own defaults must not be reachable.
  it('carries no Tailwind default colour', () => {
    expect(colors.blue).toBeUndefined();
    expect(colors.gray).toBeUndefined();
  });

  it('exposes radius, spacing, and type from tokens.ts', () => {
    expect(Object.keys(preset.theme.borderRadius).length).toBeGreaterThan(0);
    expect(Object.keys(preset.theme.spacing).length).toBeGreaterThan(0);
    expect(Object.keys(preset.theme.fontSize).length).toBeGreaterThan(0);
    expect(Object.keys(preset.theme.fontFamily).length).toBeGreaterThan(0);
  });
});
