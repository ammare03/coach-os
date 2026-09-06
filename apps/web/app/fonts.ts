// DESIGN.md §1.2's two families, self-hosted.
//
// `next/font/google` downloads both at build time and serves them from our
// own origin. There is no runtime request to Google — which is what lets a
// page whose URL carries a live single-use credential use a webfont at all
// (`guardian-consent/05` Approach step 5, "load no third-party resource").
//
// Both are SIL Open Font License (CLAUDE.md §3.4.3), and `next/font` ships
// inside `next`, so nothing was added to package.json.
import { Instrument_Sans, Space_Grotesk } from 'next/font/google';

/** Space Grotesk counts — headings and numerals (§1.2 weights 500/600/700). */
export const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
  variable: '--font-space-grotesk',
});

/** Instrument Sans speaks — body, labels, buttons, eyebrows (400/500/600). */
export const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-instrument-sans',
});
