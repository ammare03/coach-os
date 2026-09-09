import { readFileSync } from 'node:fs';
import path from 'node:path';

const UI_BARREL = path.resolve(__dirname, './index.ts');
const A11Y_CONTRACT = path.resolve(__dirname, './a11y-contract.test.tsx');

/**
 * Every PascalCase value export from `@coachos/ui` is a component. Type
 * exports carry `type ` and are skipped; the package's constants are
 * SCREAMING_SNAKE and its hooks and helpers are camelCase, so neither
 * matches. Copied from `apps/mobile/src/dev/gallery/__tests__/gallery-coverage.test.ts`'s
 * `exportedComponents()`, which does exactly this for gallery presence.
 */
function exportedComponents(): string[] {
  const source = readFileSync(UI_BARREL, 'utf8');
  const names = new Set<string>();

  for (const match of source.matchAll(/^\s{2}(?:export )?([A-Za-z_][\w]*),?$/gm)) {
    const name = match[1];
    if (name && /^[A-Z][A-Za-z0-9]*$/.test(name)) names.add(name);
  }
  for (const match of source.matchAll(/^export \{ ([^}]+) \} from/gm)) {
    for (const part of (match[1] ?? '').split(',')) {
      const name = part.trim();
      if (/^[A-Z][A-Za-z0-9]*$/.test(name)) names.add(name);
    }
  }

  return [...names];
}

/**
 * Components genuinely outside `a11y-contract.test.tsx`'s scope, each with
 * the reason it does not belong there. Never add a name here to silence a
 * failure without one of these being true.
 */
const EXCLUSIONS: Record<string, string> = {
  Divider: 'a decorative separator, already `accessible={false}`; nothing to assert',
  ThemeProvider: 'a context provider — renders only its children, no UI of its own',
  TextScaleProvider:
    "a context provider for the component gallery's text-scale toggle — renders only its children",
  GlassSurface:
    'a chrome material container; accessibility belongs to whatever it wraps, tested at each real use (the dock, the toast action bar, the sheet header)',
  GlassSurfaceGroup: 'a layout wrapper around `GlassSurface`, with the same reasoning',
  Pressable:
    'the shared press treatment every control in this file already wraps (Button, IconButton, Chip, SegmentedControl, AdherenceDot, Card); it only forwards accessibility props it is given, with no default of its own to assert',
  ToastProvider:
    'a queue/host component — the alert role, the announced message, and the labelled action all belong to `Toast`, which it mounts and which is tested directly',
  SkeletonCircle:
    'a single `Skeleton` shape with its label passed straight through; no accessibility logic of its own beyond `Skeleton`, which is tested directly',
  Metric:
    "a numeral-formatting text primitive with no role, state, or label of its own — grouping a value with its unit for a screen reader is the consuming stat tile's job (see ProgressRing/MacroBar), not Metric's",
  Sheet:
    "its mount/dismiss contract already has dedicated coverage in `Sheet.test.tsx`; the remaining behaviour (drag, keyboard, Android back) is hardware-only per that file's own comment",
};

describe('the a11y contract', () => {
  // Without this, a component added in a later phase gets no accessibility
  // coverage automatically, and nothing fails — the twenty-two assertions
  // this file held before this check are twenty-two components someone
  // remembered, not a guarantee about the thirtieth.
  it('asserts something about every component `packages/ui` exports, or names why not', () => {
    const source = readFileSync(A11Y_CONTRACT, 'utf8');
    const missing = exportedComponents()
      .filter((name) => !(name in EXCLUSIONS))
      .filter((name) => !new RegExp(`<${name}[\\s/>]`).test(source));

    expect(missing).toEqual([]);
  });
});
