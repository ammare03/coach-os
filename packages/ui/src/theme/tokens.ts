// MINIMAL placeholder token set — dark theme only, no light theme, no
// white-label brand override, no elevation mechanics. The full system
// (both themes, generated brand ramp, `<Surface level={n}>`) is
// `phase-04-design-system/theme-tokens/`; this file exists only so
// `packages/ui`'s first real components (built ahead of that phase to
// unblock `phase-03-identity-and-auth/auth-client/05`) have real values
// instead of hardcoding them inline. `DESIGN-SYSTEM.md` is the source of
// truth for every value below — this file never invents one.
export const colors = {
  bg: {
    sunken: '#06080B',
    DEFAULT: '#0A0D12',
    raised: '#12161D',
    overlay: '#1A1F28',
    inset: '#0E1218',
  },
  fg: {
    DEFAULT: '#F2F5F9',
    muted: '#97A2B4',
    subtle: '#5F6C7E',
    onBrand: '#FFFFFF',
  },
  brand: {
    DEFAULT: '#6366F1',
  },
  border: {
    subtle: '#1E242E',
    DEFAULT: '#2A323F',
    strong: '#3A4553',
  },
  danger: '#F43F5E',
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
} as const;

/** 4-point scale — `spacing(4)` is 16px. */
export function spacing(steps: number): number {
  return steps * 4;
}
