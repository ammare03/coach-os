// The guard that was missing when `nest()` silently dropped `urgent-text`
// (pre-phase-09 audit, finding Q9). Nothing anywhere exercised the compiled
// preset — `Text.test.tsx` asserts the class *string* `text-urgent-text`,
// which is applied whether or not Tailwind can generate it, and NativeWind
// drops an unknown class without erroring. So the defect was invisible from
// both ends.
//
// The loop in the first test is the real guard; the named cases below it are
// documentation of the collision that motivated it.
//
// The two requires below carry the same undeclared `packages/config` →
// `packages/ui` edge `../preset.js` itself does, for the same reason — see
// that file's note and UNFORGET A20.
/* eslint-disable import/no-relative-packages -- see above; UNFORGET A20. */
const { flattenColorChannels } = require('../../../ui/src/theme/to-rgb-channels.ts');
const { colors: tokenColors } = require('../../../ui/src/theme/tokens.ts');
/* eslint-enable import/no-relative-packages */
const preset = require('../preset.js');

/** @typedef {Record<string, string | Record<string, string>>} ColorTree */

const theme = preset.theme;
if (!theme || !theme.colors) {
  throw new Error('preset.theme.colors is missing — the preset did not build.');
}
const colors = /** @type {ColorTree} */ (theme.colors);

/** A group that must be nested, named so a shape regression fails legibly. */
function group(/** @type {string} */ name) {
  const node = colors[name];
  if (typeof node !== 'object') {
    throw new Error(`expected colors.${name} to be a nested group, got ${typeof node}`);
  }
  return node;
}

/** `'urgent-text'` → `colors.urgent.text`; `'urgent'` → `colors.urgent.DEFAULT`. */
function resolveChannel(/** @type {string} */ flatKey) {
  // `split` always yields at least one segment; the default is for the
  // checker, not for a case that can occur.
  const [groupName = flatKey, ...rest] = flatKey.split('-');
  const node = colors[groupName];
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
    const leaves = Object.values(colors).flatMap((node) =>
      typeof node === 'string' ? [node] : Object.values(node),
    );
    expect(leaves).toHaveLength(flatKeys.length);
  });
});

describe('tailwind preset — the urgent/urgent-text collision (Q9)', () => {
  // `tokens.ts` declares a bare `urgent` AND an `urgent-text`. Splitting on
  // the first hyphen put a string at `colors.urgent`, and the sibling's
  // assignment onto a string primitive was a silent no-op.
  it('keeps both, with the bare value under DEFAULT', () => {
    expect(group('urgent').DEFAULT).toBe('rgb(var(--color-urgent) / <alpha-value>)');
    expect(group('urgent').text).toBe('rgb(var(--color-urgent-text) / <alpha-value>)');
  });

  it('still generates text-urgent as well as text-urgent-text', () => {
    // Tailwind emits the bare utility name from `DEFAULT`, so promoting the
    // string did not cost the `text-urgent` class.
    expect(typeof group('urgent').DEFAULT).toBe('string');
  });

  it('leaves a group with no bare sibling nested as before', () => {
    // `on-deep` has no bare `on`, so it must stay a plain nested key.
    expect(group('on').deep).toBe('rgb(var(--color-on-deep) / <alpha-value>)');
    expect(group('on').DEFAULT).toBeUndefined();
    expect(group('bg').raised).toBe('rgb(var(--color-bg-raised) / <alpha-value>)');
  });
});

describe('tailwind preset — the rest of the theme is replaced, not extended', () => {
  // theme-tokens/02 §3, §5: Tailwind's own defaults must not be reachable.
  it('carries no Tailwind default colour', () => {
    expect(colors.blue).toBeUndefined();
    expect(colors.gray).toBeUndefined();
  });

  it('exposes radius, spacing, and type from tokens.ts', () => {
    expect(Object.keys(theme.borderRadius ?? {}).length).toBeGreaterThan(0);
    expect(Object.keys(theme.spacing ?? {}).length).toBeGreaterThan(0);
    expect(Object.keys(theme.fontSize ?? {}).length).toBeGreaterThan(0);
    expect(Object.keys(theme.fontFamily ?? {}).length).toBeGreaterThan(0);
  });
});
