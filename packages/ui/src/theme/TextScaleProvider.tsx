import { createContext, useContext, type ReactNode } from 'react';

// React Native has no API for changing the OS font scale from JavaScript —
// `PixelRatio.getFontScale()` is read-only and `allowFontScaling` only says
// whether to honour it. So `component-gallery/02`'s "verify every primitive
// at 200% text size" has no way to run without either changing a device
// setting by hand or giving the one text primitive a scale it can read.
//
// This is that scale, and it exists for the gallery harness. It is NOT a
// user-facing preference: dynamic type stays the OS's job everywhere else,
// and at the default (1) `Text` adds no style at all, so the production
// render path is byte-identical to what it was before this file existed.
const TextScaleContext = createContext(1);

export interface TextScaleProviderProps {
  /** 1 is unscaled. `component-gallery/01`'s toggle offers 1, 1.5, and 2. */
  scale: number;
  children: ReactNode;
}

export function TextScaleProvider({ scale, children }: TextScaleProviderProps) {
  return <TextScaleContext.Provider value={scale}>{children}</TextScaleContext.Provider>;
}

/** 1 outside a provider — `Text` renders in tests and before any provider mounts. */
export function useTextScale(): number {
  return useContext(TextScaleContext);
}
