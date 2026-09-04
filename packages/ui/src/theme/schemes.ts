// The two scheme tables — DESIGN-SYSTEM.md DS§2.2-2.6 (dark, verbatim
// `tokens.ts`) and DS§2.3/2.5/2.6 (light). Dark is the designed scheme;
// light is derived by inverting the *role*, not the hex (theme-tokens/04
// approach §1) — `bg` becomes the lightest surface, `fg` the darkest text,
// and so on. Where the two disagree, dark is right — light has no spec
// behind it beyond DESIGN-SYSTEM.md and rots faster (theme-tokens/04 risks).
//
// Brand is scheme-invariant (DS§2.4 gives one ramp, not two) — `tokens.ts`
// is still the source for it. `ThemeProvider` merges these tables with the
// brand ramp; nothing outside `packages/ui/src/theme/` reads this file.
import { colors } from './tokens.ts';

export type Scheme = 'dark' | 'light';

type SchemeColors = {
  bg: { sunken: string; DEFAULT: string; raised: string; overlay: string; inset: string };
  fg: { DEFAULT: string; muted: string; subtle: string; onBrand: string };
  border: { subtle: string; DEFAULT: string; strong: string };
  state: { onTrack: string; drifting: string; offTrack: string; noData: string };
  realtime: string;
  danger: string;
  pr: string;
};

export const schemes: Record<Scheme, SchemeColors> = {
  dark: {
    bg: colors.bg,
    fg: colors.fg,
    border: colors.border,
    state: colors.state,
    realtime: colors.realtime,
    danger: colors.danger,
    pr: colors.pr,
  },
  light: {
    bg: {
      sunken: '#EEF2F7',
      DEFAULT: '#FFFFFF',
      raised: '#FFFFFF',
      overlay: '#FFFFFF',
      inset: '#F4F7FA',
    },
    fg: {
      DEFAULT: '#0A0D12',
      muted: '#566274',
      subtle: '#8794A6',
      onBrand: '#FFFFFF',
    },
    border: {
      subtle: '#EAEEF4',
      DEFAULT: '#D9E0EA',
      strong: '#B8C4D4',
    },
    state: {
      onTrack: '#059669',
      drifting: '#D97706',
      offTrack: '#E11D48',
      noData: '#94A3B8',
    },
    realtime: '#0891B2',
    danger: '#E11D48',
    pr: '#D97706',
  },
};
