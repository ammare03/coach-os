// The two scheme tables. Dark is `DESIGN.md` §1.1 verbatim — it is the
// designed scheme and the only one the thirteen built screens specify.
//
// Light has NO spec behind it. `DESIGN.md` is a dark-first system whose
// whole visual argument (warm text on dusk navy, lightness-as-depth, glass
// over a dark canvas) does not survive inversion, so the light table below
// is derived by inverting the ROLE, not the hex, and is explicitly a
// fallback for a user who has forced light at the OS level — not a second
// designed product. Where the two disagree, dark is right.
//
// Brand is scheme-invariant (§1.1 gives one ramp, not two) — `tokens.ts`
// stays the source for it. `ThemeProvider` merges these tables with the
// brand ramp; nothing outside `packages/ui/src/theme/` reads this file.
import { colors } from './tokens.ts';

export type Scheme = 'dark' | 'light';

type SchemeColors = {
  bg: {
    outer: string;
    DEFAULT: string;
    raised: string;
    'raised-end': string;
    inset: string;
    'inset-alt': string;
  };
  fg: {
    bright: string;
    DEFAULT: string;
    glass: string;
    warm: string;
    'warm-muted': string;
    muted: string;
    subtle: string;
    faint: string;
    onBrand: string;
  };
  border: { soft: string; DEFAULT: string; strong: string; tinted: string };
  state: { onPlan: string; drifting: string; offPlan: string; notStarted: string };
  deep: string;
  urgent: string;
  'urgent-text': string;
  'on-deep': string;
};

export const schemes: Record<Scheme, SchemeColors> = {
  dark: {
    bg: colors.bg,
    fg: colors.fg,
    border: colors.border,
    state: colors.state,
    deep: colors.deep,
    urgent: colors.urgent,
    'urgent-text': colors['urgent-text'],
    'on-deep': colors['on-deep'],
  },
  light: {
    // Roles inverted: `outer` stays the darkest ground behind the device,
    // `DEFAULT` becomes the lightest canvas, and the card gradient runs the
    // other way so a card still reads as lifted off its background.
    bg: {
      outer: '#DCE1EA',
      DEFAULT: '#F7F8FB',
      raised: '#FFFFFF',
      'raised-end': '#F2F4F9',
      inset: '#E9EDF4',
      'inset-alt': '#DFE5EF',
    },
    fg: {
      bright: '#0B1120',
      DEFAULT: '#161E2F',
      glass: '#161E2F',
      warm: '#7A4530',
      // Darkened from #8C5A44, which measured 4.37:1 on `bg.outer` —
      // under SC 1.4.3's 4.5:1 floor (`contrast-audit.test.ts`). #835340
      // clears it on all six light surfaces at 4.88:1 worst case.
      'warm-muted': '#835340',
      muted: '#59637A',
      subtle: '#78829A',
      faint: '#A8B1C4',
      // Unchanged: the primary fill is the same peach gradient in both
      // schemes, so its text stays the dark ink that reads 8.4:1 on it.
      onBrand: colors.fg.onBrand,
    },
    border: {
      soft: '#E4E8F0',
      DEFAULT: '#D2D9E5',
      strong: '#B4BECE',
      tinted: '#C9A08C',
    },
    // The warmth ramp darkens rather than changing hue — the §8 ordering
    // (on-plan brightest, not-started faintest) has to survive the switch,
    // and every consumer still carries the second non-colour channel.
    state: {
      onPlan: '#C4603A',
      drifting: '#A8663F',
      offPlan: '#B51A2B',
      notStarted: '#A8B1C4',
    },
    deep: '#7A2C42',
    urgent: '#9C1626',
    'urgent-text': '#9C1626',
    // `on-deep` is the label ON the maroon surface (DESIGN.md §1.1,
    // "labels on maroon"), and `deep` stays dark in both schemes — so the
    // ink does not invert with the rest of the ramp. The previous #7A4530
    // was role-inverted along with `warm`, which put brown on maroon at
    // 1.20:1. Unchanged from dark, it reads 6.81:1 on the light `deep`.
    'on-deep': colors['on-deep'],
  },
};
