import {
  compositeOver,
  contrastRatio,
  parseColor,
  ratioOf,
  relativeLuminance,
  resolveLayers,
} from './contrast.ts';

// The audit in `contrast-audit.test.ts` is only worth its numbers if the
// arithmetic under it is right, so the arithmetic gets the WCAG worked
// examples rather than being trusted.
describe('contrast maths', () => {
  it('matches the WCAG anchors', () => {
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
    expect(contrastRatio([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
    // #767676 on white is the canonical 4.5:1 boundary in the WCAG techniques.
    expect(contrastRatio([118, 118, 118], [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio([119, 119, 119], [255, 255, 255])).toBeLessThan(4.5);
  });

  it('is order-independent', () => {
    expect(contrastRatio([13, 20, 31], [237, 239, 245])).toBeCloseTo(
      contrastRatio([237, 239, 245], [13, 20, 31]),
      10,
    );
  });

  it('uses the linear segment below the 0.04045 knee', () => {
    // `brand-ramp.ts` documents its own luminance as the ^2.4 term alone,
    // valid only because every colour it sees sits well above this knee.
    // This module is pointed at the whole palette, so it implements both
    // branches — asserted here rather than assumed.
    expect(relativeLuminance([8, 8, 8])).toBeCloseTo(8 / 255 / 12.92, 8);
    expect(relativeLuminance([11, 11, 11])).toBeCloseTo(((11 / 255 + 0.055) / 1.055) ** 2.4, 8);
  });

  it('parses hex and rgba', () => {
    expect(parseColor('#161E2F')).toEqual({ rgb: [22, 30, 47], alpha: 1 });
    expect(parseColor('rgba(19,26,41,0.5)')).toEqual({ rgb: [19, 26, 41], alpha: 0.5 });
    expect(parseColor('rgb(255, 229, 218)')).toEqual({ rgb: [255, 229, 218], alpha: 1 });
    expect(() => parseColor('transparent')).toThrow();
    expect(() => parseColor('#abc')).toThrow();
  });

  it('composites alpha onto its backdrop', () => {
    expect(compositeOver([0, 0, 0], 0.5, [255, 255, 255])).toEqual([127.5, 127.5, 127.5]);
    expect(compositeOver([10, 20, 30], 1, [255, 255, 255])).toEqual([10, 20, 30]);
  });

  it('flattens a layer stack bottom-first', () => {
    expect(resolveLayers(['#000000', 'rgba(255,255,255,0.5)'])).toEqual([127.5, 127.5, 127.5]);
  });

  it('refuses a stack whose bottom layer is translucent', () => {
    // Assuming black behind an unstated backdrop is how a surface nobody
    // renders gets a passing ratio invented for it.
    expect(() => resolveLayers(['rgba(19,26,41,0.5)'])).toThrow();
  });

  it('judges a translucent foreground where it actually lands', () => {
    // A 50% white hairline on black is mid-grey on black (5.32:1), not
    // white on black (21:1).
    expect(ratioOf(['rgba(255,255,255,0.5)'], ['#000000'])).toBeCloseTo(
      contrastRatio([127.5, 127.5, 127.5], [0, 0, 0]),
      10,
    );
  });
});
