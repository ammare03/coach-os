import { colors, radius, spacing, spacingSteps } from './tokens.ts';

// Not "does this hex equal itself" — the properties that would actually
// break something if someone edited this file carelessly
// (theme-tokens/02 approach §6).
describe('tokens', () => {
  it('has every DESIGN-SYSTEM.md DS§2 semantic role', () => {
    expect(Object.keys(colors.bg).sort()).toEqual(
      ['DEFAULT', 'inset', 'overlay', 'raised', 'sunken'].sort(),
    );
    expect(Object.keys(colors.fg).sort()).toEqual(['DEFAULT', 'muted', 'onBrand', 'subtle'].sort());
    expect(Object.keys(colors.border).sort()).toEqual(['DEFAULT', 'subtle', 'strong'].sort());
    expect(Object.keys(colors.state).sort()).toEqual(
      ['onTrack', 'drifting', 'offTrack', 'noData'].sort(),
    );
    expect(colors.realtime).toBeDefined();
    expect(colors.danger).toBeDefined();
    expect(colors.pr).toBeDefined();
  });

  it('has all ten brand ramp stops plus DEFAULT', () => {
    const stops = Object.keys(colors.brand);
    for (const stop of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      expect(stops).toContain(String(stop));
    }
    expect(colors.brand.DEFAULT).toBe(colors.brand[500]);
    expect(stops).toHaveLength(11); // 10 stops + DEFAULT
  });

  it('every colour is a 6-digit hex literal', () => {
    function collectHexes(value: unknown): string[] {
      if (typeof value === 'string') return [value];
      if (value && typeof value === 'object') return Object.values(value).flatMap(collectHexes);
      return [];
    }
    for (const hex of collectHexes(colors)) {
      expect(hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('has exactly the radius scale — sm/md/lg/xl/full, nothing else', () => {
    expect(Object.keys(radius).sort()).toEqual(['full', 'lg', 'md', 'sm', 'xl'].sort());
    expect(radius).toEqual({ sm: 8, md: 12, lg: 16, xl: 24, full: 999 });
  });

  it('has exactly the spacing scale — steps 1 through 16, mapping 4px through 64px, no gaps or extras', () => {
    expect(spacingSteps).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    for (const step of spacingSteps) {
      expect(spacing(step)).toBe(step * 4);
    }
  });

  it('rejects a step outside the 1..16 scale', () => {
    expect(() => spacing(0)).toThrow();
    expect(() => spacing(17)).toThrow();
    expect(() => spacing(2.5)).toThrow();
  });
});
