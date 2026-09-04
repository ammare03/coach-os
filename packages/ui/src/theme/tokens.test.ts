import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  colors,
  duration,
  easing,
  elevation,
  fontSize,
  glass,
  radius,
  spacing,
  spacingSteps,
  tapTarget,
} from './tokens.ts';

// Not "does this hex equal itself" — the properties that would actually
// break something if someone edited this file carelessly.
describe('tokens', () => {
  it('has every DESIGN.md §1.1 semantic role', () => {
    expect(Object.keys(colors.bg).sort()).toEqual(
      ['DEFAULT', 'inset', 'inset-alt', 'outer', 'raised', 'raised-end'].sort(),
    );
    expect(Object.keys(colors.fg).sort()).toEqual(
      [
        'DEFAULT',
        'bright',
        'faint',
        'glass',
        'muted',
        'onBrand',
        'subtle',
        'warm',
        'warm-muted',
      ].sort(),
    );
    expect(Object.keys(colors.border).sort()).toEqual(
      ['DEFAULT', 'soft', 'strong', 'tinted'].sort(),
    );
    expect(Object.keys(colors.brand).sort()).toEqual(
      ['DEFAULT', 'deep', 'lift', 'mid', 'shade'].sort(),
    );
    expect(Object.keys(colors.primary).sort()).toEqual(['from', 'to'].sort());
    expect(colors.deep).toBeDefined();
    expect(colors.urgent).toBeDefined();
    expect(colors['urgent-text']).toBeDefined();
    expect(colors['on-deep']).toBeDefined();
  });

  // §8 — the ramp is a warmth ramp specifically because the palette has no
  // green. A green stop reappearing here means someone reintroduced the
  // traffic-light model the whole state system was built to avoid.
  it('has the four adherence states, and none of them is green', () => {
    expect(Object.keys(colors.state).sort()).toEqual(
      ['drifting', 'notStarted', 'offPlan', 'onPlan'].sort(),
    );
    for (const hex of Object.values(colors.state)) {
      const n = Number.parseInt(hex.slice(1), 16);
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      expect(g > r && g > b).toBe(false);
    }
    // The ramp is ordered: on-plan is the brightest signal, not-started the faintest.
    expect(colors.state.onPlan).toBe(colors.brand.DEFAULT);
    expect(colors.state.drifting).toBe(colors.brand.mid);
    expect(colors.state.notStarted).toBe(colors.fg.faint);
  });

  it('every colour token is a 6-digit hex literal', () => {
    function collectHexes(value: unknown): string[] {
      if (typeof value === 'string') return [value];
      if (value && typeof value === 'object') return Object.values(value).flatMap(collectHexes);
      return [];
    }
    for (const hex of collectHexes(colors)) {
      expect(hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('has exactly the DESIGN.md §1.4 radius ladder', () => {
    expect(radius).toEqual({
      cell: 3,
      chip: 7,
      control: 12,
      card: 16,
      section: 22,
      sheet: 28,
      full: 999,
    });
  });

  it('has the DESIGN.md §1.4 spacing scale, where the step is the pixel value', () => {
    for (const step of spacingSteps) {
      expect(spacing(step)).toBe(step);
    }
    expect(spacingSteps).toContain(11);
    expect(spacingSteps).toContain(22);
  });

  it('rejects a step outside the closed scale', () => {
    expect(() => spacing(1)).toThrow();
    expect(() => spacing(15)).toThrow();
    expect(() => spacing(2.5)).toThrow();
  });

  // §1.3/§13 — the two floors. Lowering either is a product decision, not a
  // layout tweak, so it fails a test rather than passing silently.
  it('holds the tap-target floors', () => {
    expect(tapTarget.MIN).toBe(44);
    expect(tapTarget.MID_SET).toBe(52);
  });

  // §2 — five levels, and L4 (glass) is a composite that lives in
  // `GlassSurface`, not here. A sixth level means the layout is too deep.
  it('has exactly the four static elevation levels', () => {
    expect(Object.keys(elevation).sort()).toEqual(['canvas', 'inset', 'raised', 'tinted'].sort());
  });

  // §4 — the two inset edges are the whole trick. A tier that loses its
  // highlight renders as a flat translucent rectangle.
  it('gives every glass tier the bright inset edge', () => {
    expect(Object.keys(glass).sort()).toEqual(['tier1', 'tier2', 'tier3'].sort());
    for (const tier of Object.values(glass)) {
      expect(tier.highlight).toMatch(/^rgba\(/);
      expect(tier.gradient.length).toBe(tier.locations.length);
      expect(tier.blur).toBeGreaterThan(0);
    }
    // Tiers 1 and 2 carry the dark bottom edge and an outer drop; tier 3 has neither.
    expect(glass.tier1.lowlight).toBeDefined();
    expect(glass.tier2.lowlight).toBeDefined();
    expect(glass.tier3.lowlight).toBeUndefined();
    expect(glass.tier3.shadow).toBeUndefined();
  });

  // §5 — five durations, seven curves. Nothing animates off this list.
  it('has the closed motion vocabulary', () => {
    expect(Object.keys(duration)).toHaveLength(5);
    expect(Object.keys(easing)).toHaveLength(7);
    for (const curve of Object.values(easing)) {
      expect(curve).toHaveLength(4);
    }
    // `celebrate` is the only curve allowed to overshoot past 1 on the
    // second control point (§5) — the PR moment and nothing else.
    const overshooting = Object.entries(easing).filter(
      ([, c]) => (c[3] ?? 0) > 1 || (c[1] ?? 0) > 1,
    );
    expect(overshooting.map(([name]) => name).sort()).toEqual(
      ['celebrate', 'cellPop', 'digit', 'matrixPop'].sort(),
    );
    expect(easing.celebrate[1]).toBeGreaterThan(easing.matrixPop[1]);
  });

  it('has a type scale whose largest sizes carry negative tracking', () => {
    expect(fontSize.display[1].letterSpacing).toBe('-0.03em');
    expect(fontSize.h2[1].letterSpacing).toBe('-0.02em');
    expect(fontSize.eyebrow[1].letterSpacing).toBe('0.08em');
    expect(fontSize.body[0]).toBe(15);
    expect(fontSize['body-lg'][0]).toBe(16);
  });
});

// `apps/mobile/src/global.css` is generated from this file but CSS cannot
// import TS, so nothing but this test stops the two drifting apart. A
// mismatch is a failing test, not a silently wrong colour at runtime.
describe('global.css stays in sync with tokens.ts', () => {
  it('declares exactly one variable per flattened colour token, with matching channels', () => {
    const css = readFileSync(join(__dirname, '../../../../apps/mobile/src/global.css'), 'utf8');

    const flat: Record<string, string> = {};
    for (const [group, value] of Object.entries(colors)) {
      if (typeof value === 'string') {
        flat[group] = value;
        continue;
      }
      for (const [key, hex] of Object.entries(value)) flat[`${group}-${key}`] = hex as string;
    }

    const declared = new Set(
      [...css.matchAll(/--color-([a-zA-Z-]+):\s*([\d ]+);/g)].map((m) => m[1] as string),
    );
    expect([...declared].sort()).toEqual(Object.keys(flat).sort());

    for (const [name, hex] of Object.entries(flat)) {
      const n = Number.parseInt(hex.slice(1), 16);
      const expected = `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
      expect(css).toContain(`--color-${name}: ${expected};`);
    }
  });
});
