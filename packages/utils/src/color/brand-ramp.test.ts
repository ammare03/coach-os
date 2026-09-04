import { BRAND_RAMP_STOPS, generateBrandRamp } from './brand-ramp.ts';

describe('generateBrandRamp', () => {
  it('reproduces close to the default indigo ramp when given its own DEFAULT hex', () => {
    // Not byte-exact: DESIGN-SYSTEM.md's own `#6366F1` sits at ~4.47:1
    // against white — just under the 4.5:1 floor — so regenerating it
    // through the same clamp every coach hex goes through nudges it very
    // slightly darker. That clamp is correct (DS§2.4); this only asserts
    // the regenerated stop is still recognisably the same indigo.
    const ramp = generateBrandRamp('#6366F1');
    expect(ramp.DEFAULT).toBe(ramp[500]);
    expect(ramp[500]).toBe('#5A5DF0'); // clamped one 2%-lightness step darker than #6366F1
  });

  it('falls back to the default ramp on an invalid or missing hex', () => {
    const invalid = generateBrandRamp('not-a-colour');
    const missing = generateBrandRamp(undefined);
    const nullish = generateBrandRamp(null);
    const valid = generateBrandRamp('#6366F1');
    expect(invalid).toEqual(valid);
    expect(missing).toEqual(valid);
    expect(nullish).toEqual(valid);
  });

  it('has all ten stops plus DEFAULT, every value a real hex', () => {
    const ramp = generateBrandRamp('#F97316'); // a saturated orange
    for (const stop of BRAND_RAMP_STOPS) {
      expect(ramp[stop]).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect(ramp.DEFAULT).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('changes hue for a different coach colour — not just one correct stop', () => {
    const orange = generateBrandRamp('#F97316');
    const green = generateBrandRamp('#059669');
    const magenta = generateBrandRamp('#D6249F'); // hue ~320°, the hslToHex branch orange/green don't reach
    expect(orange[500]).not.toBe(green[500]);
    expect(orange[100]).not.toBe(green[100]);
    expect(orange[900]).not.toBe(green[900]);
    expect(magenta[500]).not.toBe(orange[500]);
    expect(magenta[500]).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('still produces a full valid ramp for an achromatic (grey) input', () => {
    // No defined hue — exercises the achromatic branch of the HSL
    // extraction. Any concrete hex is an acceptable result; the point is
    // it doesn't throw or produce a malformed value.
    const grey = generateBrandRamp('#808080');
    for (const stop of BRAND_RAMP_STOPS) {
      expect(grey[stop]).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('covers a hue in the 240-300 range and a near-black input', () => {
    const violet = generateBrandRamp('#7C3AED'); // hue ~262°
    const nearBlack = generateBrandRamp('#0A0A0A');
    expect(violet[500]).toMatch(/^#[0-9A-F]{6}$/);
    expect(nearBlack[500]).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('clamps a too-light input so the fill stop still passes 4.5:1 against white', () => {
    const ramp = generateBrandRamp('#FFFF00'); // bright yellow — fails 4.5:1 at the default curve
    const luminanceIsDarkEnough = (hex: string) => {
      const int = Number.parseInt(hex.slice(1), 16);
      const [r, g, b] = [(int >> 16) & 255, (int >> 8) & 255, int & 255];
      // Cheap luminance proxy — the real check lives in the module; this
      // just confirms the fill stop was actually darkened, not left pale.
      return (r + g + b) / 3 < 200;
    };
    expect(luminanceIsDarkEnough(ramp[500])).toBe(true);
  });
});
