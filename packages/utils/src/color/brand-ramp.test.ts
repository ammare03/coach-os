import { BRAND_RAMP_STOPS, contrastAgainstInk, generateBrandRamp } from './brand-ramp.ts';

const HEX = /^#[0-9A-F]{6}$/;

describe('generateBrandRamp', () => {
  it('round-trips the default accent exactly, and its siblings near-exactly', () => {
    const ramp = generateBrandRamp('#FFA586');
    // The accent itself is byte-exact: `CURVE.DEFAULT` was extracted from
    // this very hex, so the HSL round-trip closes.
    expect(ramp.DEFAULT).toBe('#FFA586');

    // The other four are not, and should not be. `DESIGN.md` §1.1's ramp
    // was hand-tuned per stop, so each hand-picked stop carries a slightly
    // different hue (`lift` sits at 16.6°, `shade` at 22.0°). The generator
    // deliberately applies ONE hue across the whole curve — that is what
    // keeps a coach's generated ramp coherent instead of wandering in hue —
    // so a regenerated sibling lands near the hand-tuned token rather than
    // on it. Worst observed drift is 9/255 on `shade`'s green channel,
    // ~3.5% of the range and visually indistinguishable; the tolerance is
    // set just above it. Pinning exact bytes would only re-type the
    // implementation, and a drift materially larger than this would mean
    // the curve and the tokens had genuinely diverged.
    const channels = (hex: string) => {
      const n = Number.parseInt(hex.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const near = (a: string, b: string) =>
      channels(a).every((v, i) => Math.abs(v - (channels(b)[i] as number)) <= 10);

    expect(near(ramp.lift, '#FFC0A8')).toBe(true);
    expect(near(ramp.mid, '#E0855F')).toBe(true);
    expect(near(ramp.deep, '#B96341')).toBe(true);
    expect(near(ramp.shade, '#8E5A3C')).toBe(true);
  });

  it('falls back to the default ramp on an invalid or missing hex', () => {
    const valid = generateBrandRamp('#FFA586');
    expect(generateBrandRamp('not-a-colour')).toEqual(valid);
    expect(generateBrandRamp(undefined)).toEqual(valid);
    expect(generateBrandRamp(null)).toEqual(valid);
  });

  it('has all five named stops, every value a real hex', () => {
    const ramp = generateBrandRamp('#F97316'); // a saturated orange
    expect(Object.keys(ramp).sort()).toEqual([...BRAND_RAMP_STOPS].sort());
    for (const stop of BRAND_RAMP_STOPS) {
      expect(ramp[stop]).toMatch(HEX);
    }
  });

  it('changes hue for a different coach colour — not just one correct stop', () => {
    const orange = generateBrandRamp('#F97316');
    const green = generateBrandRamp('#059669');
    const magenta = generateBrandRamp('#D6249F'); // hue ~320°, a branch the others don't reach
    expect(orange.DEFAULT).not.toBe(green.DEFAULT);
    expect(orange.lift).not.toBe(green.lift);
    expect(orange.shade).not.toBe(green.shade);
    expect(magenta.DEFAULT).not.toBe(orange.DEFAULT);
    expect(magenta.DEFAULT).toMatch(HEX);
  });

  it('keeps the ramp ordered light-to-dark whatever the input hue', () => {
    // The curve is the shape; only the hue changes per coach. If a stop
    // ever overtakes its neighbour the multi-series charts (§7) lose the
    // ordering they encode data with.
    const brightness = (hex: string) => {
      const n = Number.parseInt(hex.slice(1), 16);
      return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255);
    };
    for (const input of ['#FFA586', '#F97316', '#059669', '#7C3AED', '#D6249F']) {
      const r = generateBrandRamp(input);
      expect(brightness(r.lift)).toBeGreaterThanOrEqual(brightness(r.DEFAULT));
      expect(brightness(r.DEFAULT)).toBeGreaterThan(brightness(r.mid));
      expect(brightness(r.mid)).toBeGreaterThan(brightness(r.deep));
      expect(brightness(r.deep)).toBeGreaterThan(brightness(r.shade));
    }
  });

  it('still produces a full valid ramp for an achromatic (grey) input', () => {
    const grey = generateBrandRamp('#808080');
    for (const stop of BRAND_RAMP_STOPS) {
      expect(grey[stop]).toMatch(HEX);
    }
  });

  it('covers a hue in the 240-300 range and a near-black input', () => {
    expect(generateBrandRamp('#7C3AED').DEFAULT).toMatch(HEX); // hue ~262°
    expect(generateBrandRamp('#0A0A0A').DEFAULT).toMatch(HEX);
  });

  // This is the invariant the removed contrast clamp used to enforce at
  // runtime. `DESIGN.md` §1.1 puts DARK ink on the peach fill, and the
  // curve's fixed 76.3% lightness makes the 4.5:1 floor structural rather
  // than conditional — so it is asserted here, over the whole hue circle,
  // instead of re-checked on every call. Re-cut `CURVE` darker and this
  // fails before a coach ever sees an unreadable button.
  it('produces a fill that clears 4.5:1 against the dark on-brand ink, for every hue', () => {
    let worst = Number.POSITIVE_INFINITY;
    for (let hue = 0; hue < 360; hue += 1) {
      // Drive the generator through real hex inputs across the circle.
      const { DEFAULT } = generateBrandRamp(hueToHex(hue));
      worst = Math.min(worst, contrastAgainstInk(DEFAULT));
    }
    expect(worst).toBeGreaterThanOrEqual(4.5);
  });

  it('measures contrast against the ink, not against white', () => {
    // The pairing `DESIGN.md` §1.1 rejects: #FFA586 under white text reads
    // 2.6:1. Under the dark ink the same fill reads 8.4:1. Guards against
    // anyone "fixing" the direction back to a light-text assumption.
    expect(contrastAgainstInk('#FFA586')).toBeGreaterThan(8);
  });
});

/** A fully-saturated, mid-light hex at the given hue — a stand-in coach brand colour. */
function hueToHex(hue: number): string {
  const c = 1;
  const x = 1 - Math.abs(((hue / 60) % 2) - 1);
  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  const toByte = (n: number) =>
    Math.round(n * 191 + 32)
      .toString(16)
      .padStart(2, '0');
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}
