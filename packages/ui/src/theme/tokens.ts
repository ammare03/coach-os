// The only file in the repository that may contain a colour, a radius, or a
// spacing value. `DESIGN.md` is the source of truth for every value below —
// this file never invents one. `DESIGN.md` supersedes the palette and type
// scale in `DESIGN-SYSTEM.md`; the structure rules there (page patterns,
// density, copy law) still hold and are restated in `DESIGN.md` §10.
//
// This holds the DARK column only — dark is the designed scheme and the
// only one the prototypes specify (`CLAUDE.md` §7.1). The light column is
// derived by role in `schemes.ts` and has no spec behind it.
//
// Nothing outside `packages/ui/src/theme/**` may import `colors` directly —
// `brand` is overridden per coach on Studio+ (white-label, `CLAUDE.md`
// §15.2), so a component that reads `colors.brand` in JS bakes in the
// default forever. Use a `bg-brand` class, or (for genuine non-Tailwind
// consumers — SVG fills, gradient stops, Reanimated targets) `useTheme()`.
//
// DESIGN.md §1.1 — six source swatches; everything else is a tint derived
// from them. The palette has NO GREEN: adherence is a warmth ramp plus a
// second non-colour channel (§8), never hue alone.
export const colors = {
  bg: {
    // §1.1 derived neutrals. `outer` is the page behind the device and the
    // annotator backdrop; `inset` is the recessed-well fill (L1).
    outer: '#0E141F',
    DEFAULT: '#161E2F',
    raised: '#242F49',
    'raised-end': '#1B2439',
    inset: '#131A29',
    'inset-alt': '#1D2639',
  },
  fg: {
    // §1.1 text ramp — warm-tinted, never pure grey. Contrast is measured
    // on `bg.DEFAULT` (#161E2F).
    bright: '#FFFFFF', // 15.2:1 — hero numerals only
    DEFAULT: '#EDEFF5', // 13.6:1 — body, titles
    glass: '#FDF3EF', // body and icons ON GLASS (§4)
    warm: '#F0C7B4', // 8.9:1 — secondary values, meal totals
    'warm-muted': '#DEC7BE', // 7.6:1 — secondary text on glass
    muted: '#97A1B5', // 5.6:1 — labels, eyebrows, captions
    subtle: '#6B7689', // 3.1:1 — timestamps, units. ≥14px ONLY (§13)
    faint: '#4E5A70', // 2.0:1 — disabled, chevrons. NEVER carries meaning
    onBrand: '#161E2F', // §1.1 primary fill inverts: dark text on peach
  },
  border: {
    soft: '#2C374C', // row dividers inside a card
    DEFAULT: '#384358', // default 1px card border, axis lines
    strong: '#3F4B62', // interactive control borders (steppers, pills)
    tinted: '#4E5A70', // L3 tinted-card border
  },
  // §1.1 derived warm ramp. The single accent cannot carry a multi-series
  // chart, so two mid-tones are interpolated from #FFA586 toward #541A2E.
  brand: {
    lift: '#FFC0A8', // brightest data point, latest bar
    DEFAULT: '#FFA586', // primary series, active icon, sparkline stroke
    mid: '#E0855F', // second series, drifting state, bar fills
    deep: '#B96341', // third series, gradient end
    shade: '#8E5A3C', // border on dimmed/partial states
  },
  // §1.1 primary-fill stops. Light-on-dark inversion: this gradient with
  // `fg.onBrand` text reads 8.4:1. Filling with `brand.DEFAULT` under white
  // text lands at 2.6:1 and is forbidden.
  primary: {
    from: '#FFC9B2',
    to: '#FF9B76',
  },
  // §1.1 — maroon tint under warm surfaces and avatar gradients.
  deep: '#541A2E',
  // §8 adherence state — a WARMTH ramp, reserved for adherence surfaces
  // only, never decorative (enforced by the `theme/adherence-colors-only`
  // lint rule). Every consumer must also carry the second, non-colour
  // channel listed in §8; hue alone is a defect.
  state: {
    onPlan: '#FFA586', // filled dot / full-height solid bar
    drifting: '#E0855F', // hollow ring / 15px translucent bar
    offPlan: '#B51A2B', // hollow ring / 11px outline bar
    notStarted: '#4E5A70', // dashed ring / 8px dashed stub
  },
  // §1.1 — missed, overdue, record, destructive. Never decorative.
  urgent: '#B51A2B',
  // §1.1 accent text on dark — urgent labels, and labels on maroon.
  'urgent-text': '#FF8A9B',
  'on-deep': '#FFD4C0',
} as const;

// §1.4 — the radius ladder, named by what it is applied to. Buttons and
// docks are always fully rounded (`height / 2`, i.e. `full`); cards never
// are.
export const radius = {
  cell: 3, // roster cell, habit cell, bar
  chip: 7, // matrix cell, photo thumb
  control: 12, // control, small icon tile, stepper
  card: 16, // card, list item, sheet row
  section: 22, // section card, hero, media frame
  sheet: 28, // bottom-sheet top corners
  full: 999, // pill, button, dock, action bar
} as const;

// §1.4 — a 1px scale, since the prototypes use odd steps (11, 13, 22) that
// a 4-point grid cannot express. The closed set is the constraint: a step
// outside it is a design decision, not a layout tweak. Prefer flex/grid
// `gap`; never a margin between siblings.
export const SPACING_STEPS = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 26, 32, 40, 52, 64,
] as const;

export type SpacingStep = (typeof SPACING_STEPS)[number];

/** `spacing(16)` is 16px. Throws outside the §1.4 scale. */
export function spacing(step: number): number {
  if (!(SPACING_STEPS as readonly number[]).includes(step)) {
    throw new Error(
      `spacing: ${step} is not on the DESIGN.md §1.4 scale (${SPACING_STEPS.join(', ')}).`,
    );
  }
  return step;
}

export const spacingSteps: readonly number[] = SPACING_STEPS;

// §1.2 — two families, no third. Space Grotesk carries every numeral and
// heading (chosen for its tabular figures); Instrument Sans carries body,
// labels, and buttons. Each weight is a separate family name: React Native
// does not reliably resolve `fontWeight` against one family, so
// `Text`/`Metric` pick a *family*, never a `fontWeight`.
// Kebab-case keys — Tailwind emits `font-${key}` verbatim.
export const fontFamily = {
  sans: 'InstrumentSans-Regular',
  'sans-medium': 'InstrumentSans-Medium',
  'sans-semibold': 'InstrumentSans-SemiBold',
  display: 'SpaceGrotesk-Medium',
  'display-semibold': 'SpaceGrotesk-SemiBold',
  'display-bold': 'SpaceGrotesk-Bold',
  mono: 'ui-monospace', // §1.2 — placeholder captions and ids only, 9–11px
} as const;

// §1.2 — the closed type scale. Each entry is `[size, { lineHeight,
// letterSpacing }]`, Tailwind's tuple form, which this overrides wholesale
// so `text-3xl` and the rest of Tailwind's defaults do not exist.
// -.02em on anything ≥21px, -.03em on the two largest, .08em on eyebrows.
export const fontSize = {
  display: [52, { lineHeight: '52px', letterSpacing: '-0.03em' }],
  'numeral-xl': [46, { lineHeight: '46px', letterSpacing: '-0.03em' }],
  stat: [30, { lineHeight: '34px', letterSpacing: '-0.02em' }],
  'h1-client': [26, { lineHeight: '30px', letterSpacing: '-0.02em' }],
  h1: [25, { lineHeight: '29px', letterSpacing: '-0.02em' }],
  h2: [21, { lineHeight: '25px', letterSpacing: '-0.02em' }],
  title: [20, { lineHeight: '26px', letterSpacing: '0' }],
  'body-lg': [16, { lineHeight: '24px', letterSpacing: '0' }],
  body: [15, { lineHeight: '22px', letterSpacing: '0' }],
  'body-sm': [14, { lineHeight: '20px', letterSpacing: '0' }],
  numeral: [15, { lineHeight: '19px', letterSpacing: '0' }],
  label: [15, { lineHeight: '20px', letterSpacing: '0' }],
  caption: [12, { lineHeight: '17px', letterSpacing: '0' }],
  micro: [11, { lineHeight: '15px', letterSpacing: '0' }],
  eyebrow: [11, { lineHeight: '16px', letterSpacing: '0.08em' }],
} as const;

// §1.3 — two density settings, one prop. Density changes whitespace and
// secondary type. It never changes the body floor and it never changes a
// tap target (§13: ≥44px everywhere, ≥52px mid-set).
export const density = {
  client: {
    body: 16,
    gutter: 20,
    row: 66,
    button: 52,
    sectionGap: 20,
    cardPadding: 18,
  },
  coach: {
    body: 15,
    gutter: 16,
    row: 56,
    button: 46,
    sectionGap: 16,
    cardPadding: 14,
  },
} as const;

export type Density = keyof typeof density;

// §13 — the two tap floors. `MIN` applies everywhere; `MID_SET` applies to
// anything used with sweaty hands mid-workout (logger steppers, nav items).
export const tapTarget = {
  MIN: 44,
  MID_SET: 52,
} as const;

// §2 — the five-level elevation ladder. A surface sits on exactly one.
// L4 (glass) is not here: it is a composite that needs blur and a gradient,
// and it lives in `GlassSurface` (§4).
export const elevation = {
  /** L0 — canvas. The app background plus the ambient layer (§3). */
  canvas: {
    backgroundColor: colors.bg.DEFAULT,
  },
  /** L1 — inset. Recessed wells: inputs, tracks, ring remainders. */
  inset: {
    backgroundColor: 'rgba(19,26,41,0.5)',
    borderWidth: 1,
    borderColor: colors.border.soft,
  },
  /** L2 — raised card. The workhorse: gradient fill, hairline top highlight, soft drop. */
  raised: {
    gradient: [colors.bg.raised, colors.bg['raised-end']] as const,
    borderWidth: 1,
    borderColor: colors.border.DEFAULT,
    highlight: 'rgba(255,229,218,0.07)',
    shadow: {
      shadowColor: '#000000',
      shadowOpacity: 0.6,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 10 },
      elevation: 6,
    },
  },
  /** L3 — tinted card. The only way to say "this one is different" without colour-coding it. */
  tinted: {
    gradient: ['rgba(224,133,95,0.16)', 'rgba(255,165,134,0.07)'] as const,
    borderWidth: 1,
    borderColor: colors.border.tinted,
  },
} as const;

// §4 — the three glass tiers. Every tier shares a 158° warm-white →
// transparent → peach gradient, a bright inset top edge, a dark inset
// bottom edge, and (tiers 1–2) a long soft drop.
//
// The two inset edges are the whole trick: React Native has no inset
// box-shadow, so `GlassSurface` fakes them with absolutely-positioned 1px
// hairlines. Skipping them collapses the effect (§12).
export const glass = {
  tier1: {
    // dock, action bar, tool palette
    gradient: [
      'rgba(255,229,218,0.18)',
      'rgba(255,229,218,0.07)',
      'rgba(255,165,134,0.18)',
    ] as const,
    locations: [0, 0.48, 1] as const,
    blur: 34,
    borderColor: 'rgba(255,229,218,0.22)',
    highlight: 'rgba(255,255,255,0.34)',
    lowlight: 'rgba(0,0,0,0.28)',
    shadow: {
      shadowColor: '#000000',
      shadowOpacity: 0.8,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 18 },
      elevation: 12,
    },
  },
  tier2: {
    // hero card, sheet, screen header
    gradient: [
      'rgba(255,229,218,0.15)',
      'rgba(255,229,218,0.05)',
      'rgba(255,165,134,0.16)',
    ] as const,
    locations: [0, 0.46, 1] as const,
    blur: 30,
    borderColor: 'rgba(255,229,218,0.17)',
    highlight: 'rgba(255,255,255,0.30)',
    lowlight: 'rgba(0,0,0,0.28)',
    shadow: {
      shadowColor: '#000000',
      shadowOpacity: 0.7,
      shadowRadius: 22,
      shadowOffset: { width: 0, height: 22 },
      elevation: 14,
    },
  },
  tier3: {
    // chip, avatar, floating icon button — no outer shadow
    gradient: ['rgba(255,229,218,0.16)', 'rgba(255,165,134,0.14)'] as const,
    locations: [0, 1] as const,
    blur: 18,
    borderColor: 'rgba(255,229,218,0.20)',
    highlight: 'rgba(255,255,255,0.28)',
    lowlight: undefined,
    shadow: undefined,
  },
} as const;

export type GlassTier = keyof typeof glass;

// §9 — the control surfaces. These are the translucent fills and hairlines
// the button and stepper specimens are built from, and they live here for
// the same reason every other value does: this is the only file allowed to
// hold one. `bg.inset` at a fraction is not expressible as a token colour
// (Tailwind's `/40` modifier does not reach a React Native `StyleSheet`),
// so the resolved rgba is written down once rather than inlined at six
// call sites.
export const control = {
  /** Secondary button and stepper fill — `bg.inset` at 50%. */
  surface: 'rgba(19,26,41,0.5)',
  /** Disabled fill, every variant. The difference between variants stops mattering once a control cannot be pressed. */
  surfaceDisabled: 'rgba(19,26,41,0.4)',
  /** A well that must stay legible under text — the input's own field (§9). */
  surfaceSubtle: 'rgba(19,26,41,0.2)',
  /** The segmented-control track (§9). It never recolours; the pill moves. */
  track: 'rgba(19,26,41,0.6)',
  /** The bottom sheet's 42x5 grabber (§9). */
  grabber: 'rgba(255,229,218,0.35)',
  /** The warm 1px hairline on a secondary control. */
  border: 'rgba(255,229,218,0.14)',
  /** Stepper's brighter hairline (§9). */
  borderBright: 'rgba(255,229,218,0.16)',
  /**
   * The stepper key's inset top edge — §9's `inset 0 1px 0
   * rgba(255,255,255,.14)`, rendered as a faked hairline (§12). Dimmer than
   * `primaryHighlight` because the fill underneath is dark rather than peach.
   */
  stepperHighlight: 'rgba(255,255,255,0.14)',
  /**
   * The primary button's two inset edges (§9). Brighter and heavier than a
   * card's, because the surface underneath is light rather than dark — this
   * is what makes the fill read as a physical, pressable key. The press
   * treatment collapses them (`Pressable`).
   */
  primaryHighlight: 'rgba(255,255,255,0.9)',
  primaryLowlight: 'rgba(22,30,47,0.16)',
  /**
   * The ring a dock badge or a presence dot wears so it reads against a
   * photo or a glass surface of any brightness — `bg.DEFAULT` at 60% (§9).
   */
  ring: 'rgba(22,30,47,0.6)',
  /** The pressed scrim on a surface that cannot scale (a full-width card). */
  pressScrim: 'rgba(0,0,0,0.12)',
  /** The primary button's peach glow. */
  primaryGlow: {
    shadowColor: colors.brand.DEFAULT,
    shadowOpacity: 0.5,
    shadowRadius: 11,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
} as const;

// §7 — data visualisation. Three values §2's elevation ladder does not
// already carry, because a chart's own wells are a shade deeper than a
// card's: `elevation.inset` is rgba(19,26,41,0.5) and `control.track` is
// 0.6, and §7 pins a ring's remainder and a progress bar's track to two
// different values again. Written down here rather than inlined at the two
// call sites, for the same reason as everything else in this file.
//
// `overTarget` is the whole of §7's overflow rule: going past a target is
// NOT a failure state and never renders in `urgent`. §7 says "over-target
// is muted #3F4B62, never red" — that is `border.strong`, reached through
// this alias so a reader of `ProgressRing` or `MacroBar` sees the intent
// rather than a border token doing a job it was not named for. A coach
// scanning a client list must not see a red macro bar and read it as an
// off-track client (`ui-primitives-data/02`).
export const dataviz = {
  /** §7 ring — the remainder arc behind the value sweep. */
  ringTrack: 'rgba(22,30,47,0.55)',
  /** §7 progress bar — the well the fill sits in. */
  barTrack: 'rgba(19,26,41,0.7)',
  /** §7 — over-target fill and the dashed target reference line. Never red. */
  overTarget: colors.border.strong,

  // ── §7 line / area chart (`ui-primitives-data/04`) ────────────────────
  /** §7 — the series stroke. 2.5px in a full chart, 2px in a list row. */
  seriesStroke: 2.5,
  sparkStroke: 2,
  /**
   * §7's area fill: `#FFA586` from `stop-opacity .34` down to `0`. The
   * zero stop keeps the hue rather than becoming `transparent`, which is
   * `rgba(0,0,0,0)` and interpolates through black on iOS — the same trap
   * the skeleton sweep documents below.
   */
  seriesFill: ['rgba(255,165,134,0.34)', 'rgba(255,165,134,0)'] as const,
  /**
   * §7's gap treatment, and the second product failure this task exists to
   * prevent: consecutive readings more than the cadence apart are joined
   * dashed and dimmed, never solid. `3 5` is the only dash pattern §7
   * states; `.5` is §7's own de-emphasis level for the same hue (the
   * micro-spark's non-latest bars are `rgba(224,133,95,.5)`).
   */
  gapDash: [3, 5] as const,
  gapOpacity: 0.5,
  /** §7 — the reference/target line's dash. Solid axis, dashed reference. */
  referenceDash: [3, 5] as const,
  /** §7 — the latest point's dot, `4.5–5.5r`, `#FFFFFF`. */
  latestPoint: colors.fg.bright,
  latestPointRadius: 4.5,
  /**
   * The scrub crosshair's vertical rule. §7 names no colour for it — it is
   * not data, so it takes the same weight as §7's non-data reference line
   * rather than a hue of its own.
   */
  crosshair: colors.border.strong,
} as const;

// §4 — the selection pill inside a dock or segmented control. It MOVES
// between options; the track itself never recolours.
export const selectionPill = {
  gradient: ['rgba(255,229,218,0.22)', 'rgba(255,229,218,0.10)'] as const,
  highlight: 'rgba(255,255,255,0.40)',
  shadow: {
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
} as const;

// §9's Media placeholder pairs `bg.inset` with `bg.inset-alt` for "content
// that is not here"; those are the two colours a loading skeleton sweeps
// between (DESIGN-SYSTEM.md DS§6.7 — a slow, low-contrast sweep, never a
// pulsing opacity). The sweep's second stop is `bg.inset-alt` at zero
// alpha rather than `transparent`, which is rgba(0,0,0,0) and interpolates
// through black on iOS.
export const skeleton = {
  base: colors.bg.inset,
  sweep: [colors.bg['inset-alt'], 'rgba(29,38,57,0)'] as const,
} as const;

// §5 — five durations, seven curves. Nothing animates on a duration or a
// curve that is not here.
export const duration = {
  press: 120,
  state: 200, // 180–220
  enter: 300, // 260–320
  reveal: 560, // 420–700
  draw: 1200, // 900–1600
} as const;

/** §5 — cubic-bezier control points, for `Easing.bezier(...)` under Reanimated. */
export const easing = {
  out: [0, 0, 0.58, 1], // ease-out — fades, generic
  fill: [0.2, 0.8, 0.2, 1], // fills, progress, sliding pill
  rise: [0.2, 0.9, 0.2, 1], // rise/enter, sheet, bars
  cellPop: [0.2, 1.2, 0.4, 1], // roster and habit cell pop
  matrixPop: [0.2, 1.3, 0.4, 1], // matrix cell pop
  celebrate: [0.2, 1.4, 0.4, 1], // PR — the ONLY overshoot in the product
  digit: [0.3, 1.3, 0.4, 1], // rolling timer digit
} as const;

/** §5 — per-item stagger, in ms. */
export const stagger = {
  cell: 20, // habit grid, roster strip (18–22)
  matrixCell: 37, // within a row (34–40)
  matrixRow: 60,
  weekday: 55,
  chartBar: 38, // 35–40
  plate: 90, // isometric rise
} as const;

// §4 — the scrim behind a sheet or modal.
export const scrim = {
  color: 'rgba(11,15,23,0.62)',
  blur: 3,
} as const;

export type ColorTokens = typeof colors;
export type RadiusTokens = typeof radius;
export type FontFamilyTokens = typeof fontFamily;
export type TextSize = keyof typeof fontSize;
export type ElevationLevel = keyof typeof elevation;
