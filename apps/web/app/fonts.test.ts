// The brand fonts are the one thing on these two routes that *could*
// reintroduce a runtime third-party request, and one of the routes carries a
// live single-use credential in its URL (`guardian-consent/05` Approach
// step 5). `next/font/google` downloads both families at build time and
// serves them from our own origin — but only as long as nobody "fixes" it
// with a stylesheet link or a `<link rel=preconnect>`.
//
// So this is a source test, not a render test: it reads the four files that
// decide where a font byte comes from and where each family is allowed to
// land. The build-output half of the proof (no external origin in the served
// HTML) is manual, and recorded in the PR.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(...parts: string[]): string {
  return readFileSync(join(__dirname, ...parts), 'utf8');
}

const fonts = source('fonts.ts');
const design = source('design.css');
const layout = source('layout.tsx');
const consentStyles = source('guardian-consent', '[token]', 'styles.css');
const privacyStyles = source('privacy', 'styles.css');

describe('the fonts are self-hosted', () => {
  it('comes from next/font/google, which downloads at build time', () => {
    expect(fonts).toContain("from 'next/font/google'");
    expect(fonts).toMatch(/Space_Grotesk\(/);
    expect(fonts).toMatch(/Instrument_Sans\(/);
  });

  it('adds no dependency — next/font ships inside next', () => {
    const pkg = JSON.parse(source('..', 'package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };

    expect(Object.keys(all).filter((name) => name.includes('font'))).toHaveLength(0);
  });

  it('names no remote origin in any stylesheet or in the layout', () => {
    for (const file of [fonts, design, layout, consentStyles, privacyStyles]) {
      expect(file).not.toMatch(/@import\s+url\(/);
      expect(file).not.toContain('fonts.googleapis.com');
      expect(file).not.toContain('fonts.gstatic.com');
      expect(file).not.toContain('preconnect');
    }
  });

  it('exposes both families to every route from the layout', () => {
    expect(layout).toContain('spaceGrotesk.variable');
    expect(layout).toContain('instrumentSans.variable');
    expect(layout).toContain("import './design.css'");
  });
});

// DESIGN.md §1.2 — "Space Grotesk counts, Instrument Sans speaks." Two
// families, no third, and the display family is opt-in per rule rather than
// inherited: the page body is Instrument Sans and only headings override it.
describe('the two families carry the roles §1.2 gives them', () => {
  it('defines exactly the two variables, each pointing at its next/font one', () => {
    expect(design).toMatch(/--co-font-display:[\s\S]*?var\(--font-space-grotesk\)/);
    expect(design).toMatch(/--co-font-body:[\s\S]*?var\(--font-instrument-sans\)/);
  });

  it('sets the body family on the page root of both routes', () => {
    expect(consentStyles).toMatch(/\.gc-page\s*\{[\s\S]*?font-family: var\(--co-font-body\)/);
    expect(privacyStyles).toMatch(/\.pv-page\s*\{[\s\S]*?font-family: var\(--co-font-body\)/);
  });

  it('reserves the display family for headings and the wordmark', () => {
    for (const [styles, prefix] of [
      [consentStyles, 'gc'],
      [privacyStyles, 'pv'],
    ] as const) {
      const selectors = styles
        .split(/\n(?=\.)/)
        .filter((block) => block.includes('var(--co-font-display)'))
        .map((block) => block.slice(0, block.indexOf('{')).trim());

      expect(selectors.length).toBeGreaterThan(0);
      for (const selector of selectors) {
        expect(selector).toMatch(new RegExp(`^\\.${prefix}-(h[1-3]|mark-name)$`));
      }
    }
  });
});
