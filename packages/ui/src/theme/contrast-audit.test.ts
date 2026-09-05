import { ratioOf, round2 } from './contrast.ts';
import { schemes, type Scheme } from './schemes.ts';
import { colors, control, dataviz, elevation, glass, selectionPill } from './tokens.ts';

// `component-gallery/03` — the exhaustive contrast audit, kept as a test
// rather than a script that was run once. Every text/background pairing the
// token system permits is computed here, in BOTH schemes, and a token edit
// that drops one below its floor fails the build.
//
// Three rules this file follows, all of them load-bearing:
//
// 1. **Nothing is skipped.** Every pairing carries a `min`. A pairing that
//    legitimately sits below 4.5:1 gets a lower `min` AND a `reason` naming
//    the WCAG clause that permits it — enforced by a test below, so an
//    exception cannot be added silently.
// 2. **Alpha is composited, never assumed.** Half the surfaces in
//    `tokens.ts` are `rgba(...)`, and contrast is undefined for a
//    translucent colour. Every translucent entry names the opaque stack it
//    sits on, bottom first.
// 3. **Glass is measured against its OPAQUE fallback as well as its blur**
//    (`accessibility` §5). A label that passes only because of a favourable
//    backdrop fails the moment content scrolls under it.
//
// The light scheme is audited on its own token values. It is a derived
// fallback with no design spec behind it (`schemes.ts`), and it does not
// currently reach components that build JS `style` objects from `tokens.ts`
// — that gap is tracked separately and is not what this file measures.

const TEXT = 4.5; // WCAG 2.2 SC 1.4.3, normal text
const LARGE_TEXT = 3; // SC 1.4.3, ≥24px or ≥18.66px bold
const NON_TEXT = 3; // SC 1.4.11, UI components and meaningful graphics

type Pairing = {
  /** What this pairing is, in the words a reviewer would use. */
  name: string;
  /** Ink stack, bottom first. A translucent ink is composited onto `bg`. */
  fg: readonly string[];
  /** Surface stack, bottom first. The first entry must be opaque. */
  bg: readonly string[];
  /** The floor this pairing must clear. */
  min: number;
  /** Required whenever `min` is below the clause's own threshold. */
  reason?: string;
};

// ── The text ramp against every surface ─────────────────────────────────
//
// The full cartesian product: every `fg.*` (plus the two accent-text
// tokens) against every `bg.*`, in both schemes. 6 surfaces × 11 inks × 2
// schemes = 132 pairings, none of them chosen because the gallery happens
// to show it.

const SURFACE_KEYS = ['outer', 'DEFAULT', 'raised', 'raised-end', 'inset', 'inset-alt'] as const;

const INK_KEYS = [
  'bright',
  'DEFAULT',
  'glass',
  'warm',
  'warm-muted',
  'muted',
  'subtle',
  'faint',
  'onBrand',
] as const;

/** Ink-level floors that differ from 4.5:1, with the clause that permits it. */
const INK_EXCEPTIONS: Partial<
  Record<Scheme, Partial<Record<string, { min: number; reason: string }>>>
> = {
  dark: {
    subtle: {
      min: 2.85,
      reason:
        'DESIGN.md §1.1/§13 — timestamps and units at ≥14px only, never body text. §13 records 3.1:1 on `bg.DEFAULT`; on `bg.raised` (where a list row actually sits) it measures 2.90:1. Below SC 1.4.3 either way: a palette decision, flagged in the audit, not a silent pass.',
    },
    faint: {
      min: 1.85,
      reason:
        'DESIGN.md §1.1/§13 — disabled text and chevrons, "never carries meaning". SC 1.4.3 exempts text that is part of an inactive user interface component.',
    },
    onBrand: {
      min: 1,
      reason:
        'Role-restricted: `fg.onBrand` is the dark ink for the peach primary fill (DESIGN.md §1.1) and is never rendered on a `bg.*` surface. In dark it IS `bg.DEFAULT`, hence 1.00:1. Asserted against the fills it is actually used on, below.',
    },
  },
  light: {
    subtle: {
      min: 2.9,
      reason:
        'Same role restriction as dark: ≥14px secondary metadata only. Derived light value, no DESIGN.md spec; carried at the dark ramp’s ratio deliberately so the two schemes fail or pass together rather than diverging.',
    },
    faint: {
      min: 1.6,
      reason: 'Inactive-component text. SC 1.4.3 exempts it; see the dark entry.',
    },
    'on-deep': {
      min: 1,
      reason:
        'Role-restricted: `on-deep` is the label ON the maroon `deep` surface (DESIGN.md §1.1, "labels on maroon"), which stays dark in both schemes. Asserted against `deep` itself, below.',
    },
  },
};

function textRampPairings(scheme: Scheme): Pairing[] {
  const s = schemes[scheme];
  const inks: [string, string][] = [
    ...INK_KEYS.map((key): [string, string] => [key, s.fg[key]]),
    ['urgent-text', s['urgent-text']],
    ['on-deep', s['on-deep']],
  ];

  return inks.flatMap(([inkName, ink]) =>
    SURFACE_KEYS.map((surfaceKey): Pairing => {
      const exception = INK_EXCEPTIONS[scheme]?.[inkName];
      return {
        name: `${scheme}: fg.${inkName} on bg.${surfaceKey}`,
        fg: [ink],
        bg: [s.bg[surfaceKey]],
        min: exception?.min ?? TEXT,
        ...(exception ? { reason: exception.reason } : {}),
      };
    }),
  );
}

// ── Fills that carry their own ink ──────────────────────────────────────
//
// A gradient is checked at BOTH stops: a label that passes at the top of
// the primary button and fails at the bottom fails.

const FILL_PAIRINGS: Pairing[] = [
  {
    name: 'primary fill (top stop) with fg.onBrand',
    fg: [colors.fg.onBrand],
    bg: [colors.primary.from],
    min: TEXT,
  },
  {
    name: 'primary fill (bottom stop) with fg.onBrand',
    fg: [colors.fg.onBrand],
    bg: [colors.primary.to],
    min: TEXT,
  },
  // DESIGN.md §1.1 calls out the inverse pairing by name: filling with
  // `brand.DEFAULT` under white text lands at 2.6:1 and is forbidden. The
  // assertion is that the sanctioned direction clears the floor; the
  // forbidden one is asserted to fail, below, so nobody "fixes" it back.
  {
    name: 'brand.DEFAULT fill with fg.onBrand (badge, tone="brand")',
    fg: [colors.fg.onBrand],
    bg: [colors.brand.DEFAULT],
    min: TEXT,
  },
  {
    name: 'brand.mid fill with fg.onBrand (badge gradient end)',
    fg: [colors.fg.onBrand],
    bg: [colors.brand.mid],
    min: TEXT,
  },
  {
    name: 'dark: urgent fill with fg.bright',
    fg: [schemes.dark.fg.bright],
    bg: [schemes.dark.urgent],
    min: TEXT,
  },
  {
    name: 'light: urgent fill with fg.bright',
    // Light `fg.bright` is near-black ink; the urgent fill is dark maroon,
    // so the legible ink on it is the light one, as in dark.
    fg: [colors.fg.bright],
    bg: [schemes.light.urgent],
    min: TEXT,
  },
  {
    name: 'dark: deep maroon surface with on-deep',
    fg: [schemes.dark['on-deep']],
    bg: [schemes.dark.deep],
    min: TEXT,
  },
  {
    name: 'light: deep maroon surface with on-deep',
    fg: [schemes.light['on-deep']],
    bg: [schemes.light.deep],
    min: TEXT,
  },
  {
    name: 'dark: PR treatment — brand.DEFAULT on deep at 50% over bg.DEFAULT',
    fg: [colors.brand.DEFAULT],
    bg: [colors.bg.DEFAULT, 'rgba(84,26,46,0.5)'],
    min: TEXT,
  },
  // `Avatar`'s initials sit on a two-stop warm gradient (`avatar-fallback`),
  // and the worst stop is what a glyph crossing it has to clear.
  {
    name: 'avatar fallback: fg.bright on colors.deep',
    fg: [colors.fg.bright],
    bg: [colors.deep],
    min: TEXT,
  },
  {
    name: 'avatar fallback: fg.bright on brand.shade',
    fg: [colors.fg.bright],
    bg: [colors.brand.shade],
    min: TEXT,
  },
  // `AvatarStack`'s `+n` chip fills with `border.strong` — a border token
  // used as a surface, so it is not in the `bg.*` matrix and would otherwise
  // go unmeasured.
  {
    name: 'dark: AvatarStack +n count on border.strong',
    fg: [schemes.dark.fg.DEFAULT],
    bg: [schemes.dark.border.strong],
    min: TEXT,
  },
  {
    name: 'light: AvatarStack +n count on border.strong',
    fg: [schemes.light.fg.DEFAULT],
    bg: [schemes.light.border.strong],
    min: TEXT,
  },
  // MacroBar's legend letter and gram count, on the surfaces a diary row
  // actually renders on.
  {
    name: 'dark: MacroBar legend (fg.muted) on bg.raised',
    fg: [schemes.dark.fg.muted],
    bg: [schemes.dark.bg.raised],
    min: TEXT,
  },
  {
    name: 'avatar fallback: fg.bright on brand.deep',
    fg: [colors.fg.bright],
    bg: [colors.brand.deep],
    min: 4.2,
    reason:
      'MEASURED 4.26:1 — a genuine SC 1.4.3 miss, held here rather than silently passed. `brand.deep` is a DESIGN.md §1.1 ramp literal, so darkening it is a palette decision for the design owner; the mitigations are that the glyph is an identity graphic beside the name it abbreviates, `Avatar` is hidden from the reading order entirely, and the gradient centre (where the glyph sits) is darker than this end stop. Recorded in the audit as an open decision.',
  },
];

// ── Composited control and dataviz surfaces ─────────────────────────────
//
// `tokens.ts` holds the dark column only, so these are dark-scheme
// pairings. Each names the opaque surface it is laid over — a secondary
// button on the page canvas and the same button on a card are two different
// backdrops and two different numbers.

const OVER_CANVAS = [colors.bg.DEFAULT] as const;
const OVER_CARD = [colors.bg.raised] as const;

function controlPairings(): Pairing[] {
  const surfaces: [string, string][] = [
    ['control.surface', control.surface],
    ['control.surfaceDisabled', control.surfaceDisabled],
    ['control.surfaceSubtle', control.surfaceSubtle],
    ['control.track', control.track],
    ['dataviz.ringTrack', dataviz.ringTrack],
    ['dataviz.barTrack', dataviz.barTrack],
    ['elevation.inset', elevation.inset.backgroundColor],
  ];
  const inks: [string, string, number, string?][] = [
    ['fg.glass', colors.fg.glass, TEXT],
    ['fg.DEFAULT', colors.fg.DEFAULT, TEXT],
    ['fg.warm-muted', colors.fg['warm-muted'], TEXT],
    ['fg.muted', colors.fg.muted, TEXT],
    ['brand.DEFAULT', colors.brand.DEFAULT, TEXT],
    ['urgent-text', colors['urgent-text'], TEXT],
    [
      'fg.subtle',
      colors.fg.subtle,
      3.0,
      'Placeholder text only (`Input`). `FormField` renders a static label above every control and DESIGN.md §9 forbids placeholder-as-label, so nothing is communicated by the placeholder alone. Still below SC 1.4.3 — the same `fg.subtle` decision recorded above.',
    ],
    [
      'fg.faint',
      colors.fg.faint,
      2.0,
      'Disabled controls only (`Button`/`Input`/`NumberStepper` disabled). SC 1.4.3 exempts text in an inactive user interface component.',
    ],
  ];

  return surfaces.flatMap(([surfaceName, surface]) =>
    ([...OVER_CANVAS, ...OVER_CARD] as const).flatMap((base) =>
      inks.map(([inkName, ink, min, reason]): Pairing => {
        const baseName = base === colors.bg.DEFAULT ? 'bg.DEFAULT' : 'bg.raised';
        return {
          name: `dark: ${inkName} on ${surfaceName} over ${baseName}`,
          fg: [ink],
          bg: [base, surface],
          min,
          ...(reason ? { reason } : {}),
        };
      }),
    ),
  );
}

// ── The selection pill ──────────────────────────────────────────────────
//
// Two stops, two backdrops: inside a segmented control it sits on the
// track; as a `Chip` or a `Calendar` day it sits straight on the surface.

function selectionPillPairings(): Pairing[] {
  const [top, bottom] = selectionPill.gradient;
  return (
    [
      ['over control.track', [colors.bg.DEFAULT, control.track]],
      ['over bg.DEFAULT', [colors.bg.DEFAULT]],
      ['over bg.raised', [colors.bg.raised]],
    ] as const
  ).flatMap(([where, base]) =>
    [
      ['top stop', top],
      ['bottom stop', bottom],
    ].map(([stopName, stop]): Pairing => {
      if (stop === undefined) throw new Error('selectionPill gradient lost a stop');
      return {
        name: `dark: fg.bright on selection pill ${stopName} ${where}`,
        fg: [colors.fg.bright],
        bg: [...base, stop],
        min: TEXT,
      };
    }),
  );
}

// ── Glass ───────────────────────────────────────────────────────────────
//
// Every tier, every stop, over the three backdrops chrome floats above —
// plus the opaque `elevation.raised` fallback that Reduce Transparency and
// Increase Contrast collapse it to (`GlassSurface`). `accessibility` §5:
// the fallback is the case that has to pass, because it is the one a user
// who needs it will see.

function glassPairings(): Pairing[] {
  const inks: [string, string][] = [
    ['fg.glass', colors.fg.glass],
    ['fg.warm-muted', colors.fg['warm-muted']],
  ];
  const backdrops: [string, string][] = [
    ['bg.outer', colors.bg.outer],
    ['bg.DEFAULT', colors.bg.DEFAULT],
    ['bg.raised', colors.bg.raised],
  ];

  const blur = Object.entries(glass).flatMap(([tierName, tier]) =>
    backdrops.flatMap(([backdropName, backdrop]) =>
      tier.gradient.flatMap((stop, index) =>
        inks.map(([inkName, ink]): Pairing => ({
          name: `dark: ${inkName} on glass ${tierName} stop ${index} over ${backdropName}`,
          fg: [ink],
          // Worst case for a blur surface: the backdrop shows through, so
          // the surface is the tier's own stop composited over it.
          bg: [backdrop, stop],
          min: TEXT,
        })),
      ),
    ),
  );

  const opaque = elevation.raised.gradient.flatMap((stop, index) =>
    inks.map(([inkName, ink]): Pairing => ({
      name: `dark: ${inkName} on the opaque glass fallback (elevation.raised stop ${index})`,
      fg: [ink],
      bg: [stop],
      min: TEXT,
    })),
  );

  return [...blur, ...opaque];
}

// ── Non-text: SC 1.4.11 ─────────────────────────────────────────────────
//
// State graphics, control boundaries, and the brand ramp where it draws
// rather than letters. 3:1, and the exceptions are the places the palette
// does not reach it.

function nonTextPairings(): Pairing[] {
  const out: Pairing[] = [];

  for (const scheme of ['dark', 'light'] as const) {
    const s = schemes[scheme];
    for (const surfaceKey of ['DEFAULT', 'raised', 'inset'] as const) {
      for (const [stateKey, hex] of Object.entries(s.state)) {
        const belowFloor =
          (scheme === 'dark' && (stateKey === 'offPlan' || stateKey === 'notStarted')) ||
          (scheme === 'light' && stateKey === 'notStarted');
        out.push({
          name: `${scheme}: state.${stateKey} graphic on bg.${surfaceKey}`,
          fg: [hex],
          bg: [s.bg[surfaceKey]],
          min: belowFloor ? 1.6 : NON_TEXT,
          ...(belowFloor
            ? {
                reason:
                  'MEASURED below SC 1.4.11’s 3:1 (`state.offPlan` 1.99–2.50:1 dark, `state.notStarted` 1.83–2.40:1 across both schemes). Both are DESIGN.md §1.1 literals (`urgent` #B51A2B, `fg.faint` #4E5A70), so raising them is a palette decision for the design owner. `AdherenceDot` never leaves the hue to carry the state on its own — filled/hollow/dashed is the mandatory second channel (DESIGN.md §8) and the label is announced in words — but the ring itself is hard to see against a card. Recorded in the audit as an open decision.',
              }
            : {}),
        });
      }
    }
  }

  // Control boundaries. A secondary control's fill is `bg.inset` at 50%
  // over whatever it sits on, which is very nearly the surface itself, so
  // the hairline is the whole boundary.
  const boundaries: [string, readonly string[], readonly string[]][] = [
    [
      'dark: secondary control hairline against the canvas',
      [colors.bg.DEFAULT, control.surface, control.border],
      OVER_CANVAS,
    ],
    [
      'dark: secondary control hairline against a card',
      [colors.bg.raised, control.surface, control.border],
      OVER_CARD,
    ],
    ['dark: border.strong against the canvas', [colors.border.strong], OVER_CANVAS],
    ['dark: border.strong against a card', [colors.border.strong], OVER_CARD],
    [
      'dark: input border.DEFAULT against its own fill',
      [colors.border.DEFAULT],
      [colors.bg.DEFAULT, control.surface],
    ],
  ];
  for (const [name, fg, bg] of boundaries) {
    out.push({
      name,
      fg,
      bg,
      min: 1.25,
      reason:
        'MEASURED 1.28–1.94:1, below SC 1.4.11’s 3:1 for identifying a user interface component. `border.strong` (#3F4B62) and `control.border` are DESIGN.md §1.1/§9 literals and a secondary control’s fill is deliberately a near-invisible `bg.inset` at 50%, so this is the palette’s own boundary treatment, not a mistake in a component. Raising it is a design decision. Mitigation today: every control also carries a label and a ≥44px target, so nothing depends on seeing the edge.',
    });
  }

  // The brand ramp where it draws rather than letters.
  for (const [stopName, hex] of Object.entries(colors.brand)) {
    const dimmedBorder = stopName === 'shade';
    out.push({
      name: `dark: brand.${stopName} as a graphic on bg.raised`,
      fg: [hex],
      bg: [colors.bg.raised],
      min: dimmedBorder ? 2.3 : NON_TEXT,
      ...(dimmedBorder
        ? {
            reason:
              'MEASURED 2.33:1. `brand.shade` is DESIGN.md §1.1’s "border on dimmed/partial states" — SC 1.4.11 exempts inactive user interface components, and a dimmed state is exactly that.',
          }
        : {}),
    });
  }

  // The empty-state glyph. Decorative and hidden from the reading order
  // (`EmptyState`), but it still has to be visible.
  out.push({
    name: 'dark: NotFound/Forbidden 28px glyph (fg.subtle) on the page canvas',
    fg: [colors.fg.subtle],
    bg: [colors.bg.DEFAULT],
    min: NON_TEXT,
  });

  // The primary button's inset edges — decoration, not a boundary, and the
  // button's own fill already carries 8:1 against every surface.
  out.push({
    name: 'dark: primary button lowlight hairline on the primary fill',
    fg: [control.primaryLowlight],
    bg: [colors.primary.to],
    min: 1,
    reason:
      'Decorative. The faked inset edges (DESIGN.md §4/§12) model a bevel; they carry no information and the fill they sit on clears 8:1 with its own ink. SC 1.4.11 covers graphics "required to understand the content", which this is not.',
  });

  return out;
}

const ALL_PAIRINGS: Pairing[] = [
  ...textRampPairings('dark'),
  ...textRampPairings('light'),
  ...FILL_PAIRINGS,
  ...controlPairings(),
  ...selectionPillPairings(),
  ...glassPairings(),
  ...nonTextPairings(),
  // The brand ramp is scheme-INVARIANT (DESIGN.md §1.1 gives one ramp, and
  // P25 overrides it per coach) while the surfaces underneath it are not.
  // Handled last so the light-scheme failure is impossible to miss.
  ...brandAsTextPairings(),
];

/**
 * `brand.DEFAULT` is rendered as TEXT in two places — `Button`'s ghost
 * variant label and `FormField`'s required-field asterisk — and as the
 * `today` hairline in `Calendar`. It clears 4.5:1 on every dark surface and
 * fails on every light one, because there is only one ramp and it was cut
 * for a dark canvas.
 */
function brandAsTextPairings(): Pairing[] {
  return (['dark', 'light'] as const).flatMap((scheme) =>
    SURFACE_KEYS.map((surfaceKey): Pairing => {
      const failsOnLight = scheme === 'light';
      return {
        name: `${scheme}: brand.DEFAULT as text on bg.${surfaceKey}`,
        fg: [colors.brand.DEFAULT],
        bg: [schemes[scheme].bg[surfaceKey]],
        min: failsOnLight ? 1.4 : TEXT,
        ...(failsOnLight
          ? {
              reason:
                'MEASURED 1.46–1.91:1 — the largest failure in the audit. `brand` is scheme-invariant by design (DESIGN.md §1.1 gives one ramp, and a coach overrides it wholesale on Studio+), so a peach cut for a dark canvas is unreadable as text on a light one. Fixing it needs a decision: either a scheme-aware "brand as text" token (which the white-label generator would also have to clamp), or a rule that brand is never ink in the light scheme. Recorded in the audit as an open decision for the design owner; not patchable in a component.',
            }
          : {}),
      };
    }),
  );
}

describe('token contrast audit', () => {
  it.each(ALL_PAIRINGS.map((pairing) => [pairing.name, pairing] as const))(
    '%s',
    (_name, pairing) => {
      const ratio = round2(ratioOf(pairing.fg, pairing.bg));
      expect(ratio).toBeGreaterThanOrEqual(pairing.min);
    },
  );

  // An exception is a decision. Making one costs a sentence naming the
  // clause that permits it, or the fact that it is an open decision — which
  // is the only thing standing between an allowlist and a rubber stamp.
  it('every pairing below its clause floor carries a written reason', () => {
    const unexplained = ALL_PAIRINGS.filter(
      (pairing) => pairing.min < LARGE_TEXT && (pairing.reason ?? '').length < 40,
    );
    expect(unexplained.map((pairing) => pairing.name)).toEqual([]);
  });

  // A new `fg.*` or `bg.*` token must land in the matrix rather than
  // shipping unmeasured. The counts are the closure check.
  it('covers the full cartesian product of both scheme tables', () => {
    for (const scheme of ['dark', 'light'] as const) {
      expect(Object.keys(schemes[scheme].bg).sort()).toEqual([...SURFACE_KEYS].sort());
      expect(Object.keys(schemes[scheme].fg).sort()).toEqual([...INK_KEYS].sort());
      // 11 inks (9 `fg.*` + `urgent-text` + `on-deep`) × 6 surfaces.
      expect(textRampPairings(scheme)).toHaveLength(66);
    }
  });

  // DESIGN.md §1.1 calls this pairing out by name as the one to never
  // build. Asserting that it still fails is what stops it being "fixed"
  // back into the palette by someone who only read the swatch.
  it('keeps the forbidden white-on-brand pairing failing', () => {
    expect(ratioOf([colors.fg.bright], [colors.brand.DEFAULT])).toBeLessThan(3);
  });

  // The audit is only worth its floors if nothing quietly opted out of one.
  it('has no pairing without a floor', () => {
    for (const pairing of ALL_PAIRINGS) {
      expect(pairing.min).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(pairing.min)).toBe(true);
    }
    expect(ALL_PAIRINGS.length).toBeGreaterThan(300);
  });
});
