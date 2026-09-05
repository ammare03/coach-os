import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { processColor, Text as RNText, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AdherenceDot } from '../components/AdherenceDot.tsx';
import { AdherenceDotRow } from '../components/AdherenceDotRow.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { AvatarStack } from '../components/AvatarStack.tsx';
import { Badge } from '../components/Badge.tsx';
import { Button } from '../components/Button.tsx';
import { Calendar } from '../components/Calendar.tsx';
import { Card } from '../components/Card.tsx';
import { Chip } from '../components/Chip.tsx';
import { ConfirmModal } from '../components/ConfirmModal.tsx';
import { Divider } from '../components/Divider.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { ForbiddenState } from '../components/ForbiddenState.tsx';
import { FormField } from '../components/FormField.tsx';
import { IconButton } from '../components/IconButton.tsx';
import { Input } from '../components/Input.tsx';
import { LineChart } from '../components/LineChart.tsx';
import { LoadingState } from '../components/LoadingState.tsx';
import { MacroBar } from '../components/MacroBar.tsx';
import { Modal } from '../components/Modal.tsx';
import { NotFoundState } from '../components/NotFoundState.tsx';
import { NumberStepper } from '../components/NumberStepper.tsx';
import { ProgressRing } from '../components/ProgressRing.tsx';
import { SegmentedControl } from '../components/SegmentedControl.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { SheetFooter } from '../components/SheetFooter.tsx';
import { SheetHeader } from '../components/SheetHeader.tsx';
import { Skeleton } from '../components/Skeleton.tsx';
import { SkeletonCircle } from '../components/SkeletonCircle.tsx';
import { SkeletonText } from '../components/SkeletonText.tsx';
import { Sparkline } from '../components/Sparkline.tsx';
import { GlassSurface } from '../surfaces/GlassSurface.tsx';
import { Toast } from '../toast/Toast.tsx';

import { schemes, schemeTokens } from './schemes.ts';
import { ThemeProvider } from './ThemeProvider.tsx';
import { colors, DARK_INK, darkSchemeTokens, deriveSchemeTokens } from './tokens.ts';

// `component-gallery/04`'s deliverable. Two guards, because they fail for
// different reasons and only one of them prevents the NEXT occurrence:
//
// 1. The RENDER guard proves the conversions worked — every primitive is
//    rendered under `scheme="light"` and asserted to emit no colour that
//    only exists in the dark table.
// 2. The IMPORT guard prevents the regression — a new component that reads
//    `control` or `colors` at module scope looks exactly like the
//    twenty-eight that did before this task, and nothing else in the build
//    would notice.
//
// A third block pins the dark derivation to DESIGN.md's literals, because
// the whole conversion rests on `deriveSchemeTokens(colors, DARK_INK)`
// reproducing the hand-written table byte for byte.

// ── 1. The dark derivation is byte-identical to DESIGN.md's literals ─────
//
// These are the values `tokens.ts` held as hand-written constants before
// the split. If one of them moves, every "dark is unchanged" claim in this
// task is void — and no component test would necessarily catch it, since
// most assert behaviour rather than a hex.

describe('the dark derivation reproduces DESIGN.md verbatim', () => {
  it('composes the elevation ladder', () => {
    expect(darkSchemeTokens.elevation.inset.backgroundColor).toBe('rgba(19,26,41,0.5)');
    expect(darkSchemeTokens.elevation.raised.gradient).toEqual(['#242F49', '#1B2439']);
    expect(darkSchemeTokens.elevation.raised.highlight).toBe('rgba(255,229,218,0.07)');
    expect(darkSchemeTokens.elevation.tinted.gradient).toEqual([
      'rgba(224,133,95,0.16)',
      'rgba(255,165,134,0.07)',
    ]);
  });

  it('composes the three glass tiers', () => {
    expect(darkSchemeTokens.glass.tier1.gradient).toEqual([
      'rgba(255,229,218,0.18)',
      'rgba(255,229,218,0.07)',
      'rgba(255,165,134,0.18)',
    ]);
    // `0.30`, not `0.3` — the alpha is carried as a string precisely so a
    // two-decimal literal survives the round trip.
    expect(darkSchemeTokens.glass.tier2.highlight).toBe('rgba(255,255,255,0.30)');
    expect(darkSchemeTokens.glass.tier3.borderColor).toBe('rgba(255,229,218,0.20)');
    expect(darkSchemeTokens.glass.tier3.lowlight).toBeUndefined();
  });

  it('composes the control surfaces', () => {
    expect(darkSchemeTokens.control.surface).toBe('rgba(19,26,41,0.5)');
    expect(darkSchemeTokens.control.surfaceDisabled).toBe('rgba(19,26,41,0.4)');
    expect(darkSchemeTokens.control.surfaceSubtle).toBe('rgba(19,26,41,0.2)');
    expect(darkSchemeTokens.control.track).toBe('rgba(19,26,41,0.6)');
    expect(darkSchemeTokens.control.grabber).toBe('rgba(255,229,218,0.35)');
    expect(darkSchemeTokens.control.border).toBe('rgba(255,229,218,0.14)');
    expect(darkSchemeTokens.control.borderBright).toBe('rgba(255,229,218,0.16)');
    expect(darkSchemeTokens.control.stepperHighlight).toBe('rgba(255,255,255,0.14)');
    expect(darkSchemeTokens.control.primaryHighlight).toBe('rgba(255,255,255,0.9)');
    expect(darkSchemeTokens.control.primaryLowlight).toBe('rgba(22,30,47,0.16)');
    expect(darkSchemeTokens.control.ring).toBe('rgba(22,30,47,0.6)');
    expect(darkSchemeTokens.control.pressScrim).toBe('rgba(0,0,0,0.12)');
  });

  it('composes dataviz, the selection pill, the skeleton, and the scrim', () => {
    expect(darkSchemeTokens.dataviz.ringTrack).toBe('rgba(22,30,47,0.55)');
    expect(darkSchemeTokens.dataviz.barTrack).toBe('rgba(19,26,41,0.7)');
    expect(darkSchemeTokens.dataviz.seriesFill).toEqual([
      'rgba(255,165,134,0.34)',
      'rgba(255,165,134,0)',
    ]);
    expect(darkSchemeTokens.selectionPill.gradient).toEqual([
      'rgba(255,229,218,0.22)',
      'rgba(255,229,218,0.10)',
    ]);
    expect(darkSchemeTokens.selectionPill.highlight).toBe('rgba(255,255,255,0.40)');
    expect(darkSchemeTokens.skeleton.sweep).toEqual(['#1D2639', 'rgba(29,38,57,0)']);
    expect(darkSchemeTokens.scrim.color).toBe('rgba(11,15,23,0.62)');
  });

  it('is pure — the same inputs give the same output', () => {
    expect(deriveSchemeTokens(colors, DARK_INK)).toEqual(darkSchemeTokens);
  });
});

// ── 2. Every primitive, rendered under both schemes ──────────────────────

const DAY = { dateISO: '2026-09-01', state: 'on-track' } as const;
const POINTS = [
  { dateISO: '2026-08-30', value: 80 },
  { dateISO: '2026-08-31', value: 81 },
  { dateISO: '2026-09-01', value: 79 },
] as const;

/** Every primitive that renders a colour, with the least interesting props that still reach its full surface. */
const SPECIMENS: Record<string, ReactElement> = {
  AdherenceDot: <AdherenceDot state="drifting" label="Drifting" />,
  AdherenceDotRow: (
    <AdherenceDotRow days={[DAY]} metric="training" todayISO="2026-09-01" showDayLabels />
  ),
  Avatar: <Avatar name="Alex Kim" userId="u1" presence="online" />,
  AvatarStack: (
    <AvatarStack
      people={[
        { name: 'Alex Kim', userId: 'u1' },
        { name: 'Priya R', userId: 'u2' },
      ]}
      max={1}
    />
  ),
  'Badge (neutral)': <Badge count={3} />,
  'Badge (brand)': <Badge count={3} tone="brand" />,
  'Button (primary)': <Button variant="primary">Save</Button>,
  'Button (secondary)': <Button variant="secondary">Save</Button>,
  'Button (ghost)': <Button variant="ghost">Add</Button>,
  'Button (danger)': <Button variant="danger">Delete</Button>,
  'Button (disabled)': (
    <Button variant="primary" disabled>
      Save
    </Button>
  ),
  Calendar: <Calendar selected={null} onSelect={() => {}} today="2026-09-01" />,
  'Card (raised)': (
    <Card elevation="raised">
      <RNText>x</RNText>
    </Card>
  ),
  'Card (inset)': (
    <Card elevation="inset">
      <RNText>x</RNText>
    </Card>
  ),
  'Card (tinted)': (
    <Card elevation="tinted">
      <RNText>x</RNText>
    </Card>
  ),
  'Chip (unselected)': <Chip label="Barbell" onPress={() => {}} />,
  'Chip (selected)': <Chip label="Barbell" selected onPress={() => {}} />,
  ConfirmModal: (
    <ConfirmModal
      isOpen
      onCancel={() => {}}
      onConfirm={() => {}}
      title="Archive client"
      body="This hides their file."
      confirmationText="ARCHIVE"
      actionLabel="Archive"
    />
  ),
  Divider: <Divider />,
  EmptyState: (
    <EmptyState title="No clients yet" primaryAction={{ label: 'Invite', onPress: () => {} }} />
  ),
  ForbiddenState: <ForbiddenState onRecover={() => {}} />,
  FormField: (
    <FormField label="Weight" error="Enter a number">
      <Input value="" onChangeText={() => {}} />
    </FormField>
  ),
  GlassSurface: (
    <GlassSurface tier="tier2">
      <RNText>x</RNText>
    </GlassSurface>
  ),
  IconButton: <IconButton icon={<View />} accessibilityLabel="Close" />,
  'Input (default)': <Input value="72" onChangeText={() => {}} />,
  'Input (disabled)': <Input value="72" onChangeText={() => {}} state="disabled" />,
  LineChart: <LineChart series={[{ points: POINTS, label: 'Weight', unit: 'kg', minSpan: 2 }]} />,
  LoadingState: <LoadingState accessibilityLabel="Loading clients" />,
  MacroBar: <MacroBar proteinG={140} carbsG={200} fatG={60} targetKcal={2000} />,
  Modal: (
    <Modal isOpen onDismiss={() => {}}>
      <RNText>x</RNText>
    </Modal>
  ),
  NotFoundState: <NotFoundState onRecover={() => {}} />,
  NumberStepper: (
    <NumberStepper
      value={60}
      onChange={() => {}}
      step={2.5}
      max={200}
      unit="kg"
      accessibilityLabel="Weight"
    />
  ),
  ProgressRing: <ProgressRing value={120} target={180} unit="g" label="Protein" />,
  SegmentedControl: (
    <SegmentedControl
      options={[
        { value: 'a', label: 'Week' },
        { value: 'b', label: 'Month' },
      ]}
      value="a"
      onChange={() => {}}
    />
  ),
  Sheet: (
    <Sheet isOpen onDismiss={() => {}}>
      <RNText>x</RNText>
    </Sheet>
  ),
  SheetFooter: <SheetFooter actionLabel="Log set" onAction={() => {}} />,
  SheetHeader: <SheetHeader title="Log set" subtitle="Set 3" onClose={() => {}} />,
  Skeleton: <Skeleton height={20} />,
  SkeletonCircle: <SkeletonCircle diameter={36} />,
  SkeletonText: <SkeletonText size="body" />,
  Sparkline: <Sparkline points={POINTS} />,
  Toast: (
    <Toast
      toastId="t1"
      message="Set removed"
      durationMs={5000}
      showCountdown
      onTimeout={() => {}}
    />
  ),
};

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

// `stroke`/`fill` are how an SVG icon (`lucide-react-native`) and a Skia
// path carry their colour — neither ends in "color".
function isColourKey(key: string): boolean {
  return /colou?rs?$/i.test(key) || key === 'stroke' || key === 'fill' || key === 'tintColor';
}

/**
 * Every colour a rendered tree actually emits — from `style` (flattened
 * through arrays), and from any prop whose name ends in `color`/`colors`.
 *
 * Numbers are collected alongside strings because `expo-linear-gradient`
 * and `expo-blur` run their colour props through React Native's
 * `processColor` before they reach the host component, so a gradient stop
 * arrives as an int. Dropping those would blind this guard to exactly the
 * surfaces the defect was worst on — cards, glass, and the primary button.
 */
function collectColours(node: Json, into: Set<string | number>): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) collectColours(child as Json, into);
    return;
  }
  const record = node as Record<string, unknown>;

  const props = record['props'];
  if (props && typeof props === 'object') {
    for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
      if (key === 'style') collectStyleColours(value, into);
      else if (isColourKey(key)) addColour(value, into);
    }
  }
  collectColours((record['children'] ?? null) as Json, into);
}

function addColour(value: unknown, into: Set<string | number>): void {
  if (typeof value === 'string' || typeof value === 'number') into.add(value);
  else if (Array.isArray(value)) for (const entry of value) addColour(entry, into);
}

function collectStyleColours(style: unknown, into: Set<string | number>): void {
  if (Array.isArray(style)) {
    for (const entry of style) collectStyleColours(entry, into);
    return;
  }
  if (!style || typeof style !== 'object') return;
  for (const [key, value] of Object.entries(style as Record<string, unknown>)) {
    if (isColourKey(key)) addColour(value, into);
  }
}

/** Every colour string a scheme's tables and derived groups can produce. */
function coloursOf(scheme: 'dark' | 'light'): Set<string> {
  const out = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      if (/^(#|rgba?\()/.test(value)) out.add(value);
      return;
    }
    if (value && typeof value === 'object') for (const entry of Object.values(value)) walk(entry);
  };
  walk(schemes[scheme]);
  walk(schemeTokens[scheme]);
  return out;
}

// The brand ramp and the primary fill are scheme-INVARIANT (DESIGN.md §1.1
// gives one of each, not two), so they are not "dark" colours even though
// `tokens.ts` holds them. Two of them collide with dark's adherence ramp
// by value, which is why this subtraction is explicit rather than implied.
const SCHEME_INVARIANT = new Set<string>([
  ...Object.values(colors.brand),
  ...Object.values(colors.primary),
]);

// A colour the DARK scheme can produce and the light one cannot. The
// difference matters: `#FFFFFF`, the peach primary fill, `fg.onBrand`, the
// modal scrim, and every black shadow are shared by both schemes on
// purpose, so asserting "no dark colour" outright would be wrong.
const LIGHT_COLOURS = coloursOf('light');
const DARK_ONLY = [...coloursOf('dark')].filter(
  (value) => !LIGHT_COLOURS.has(value) && !SCHEME_INVARIANT.has(value),
);
const DARK_ONLY_PROCESSED = new Set<string | number>([
  ...DARK_ONLY,
  ...DARK_ONLY.map((value) => processColor(value)).filter(
    (value): value is number => typeof value === 'number',
  ),
]);

/** `SheetFooter` composes the home-indicator inset, so the provider is not optional. */
function mount(specimen: ReactElement, scheme: 'dark' | 'light'): ReactElement {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <ThemeProvider scheme={scheme}>{specimen}</ThemeProvider>
    </SafeAreaProvider>
  );
}

/**
 * Specimens whose two renders are legitimately identical, each with the
 * reason — an unexplained entry here is how this guard stops meaning
 * anything. Same discipline as the `theme/no-raw-color` allowlist in
 * `packages/config/eslint.react-native.js`.
 *
 * Four of the six are test-double limits, not product facts, and are
 * therefore the part of this task that still needs a device: a chart's
 * stroke, a ring's sweep, and a sheet's glass background cannot be seen
 * through a structural double.
 */
const NO_OBSERVABLE_DIFFERENCE = new Set([
  // DESIGN.md §1.1 — the primary fill is the same peach gradient in both
  // schemes, under the same dark `fg.onBrand` ink and the same white inset
  // edges. There is nothing here that should differ.
  'Button (primary)',
  // Renders a primary Button and `Text` (class-name driven). Its glyph is
  // the caller's, so the component itself paints nothing scheme-dependent.
  'EmptyState',
  // Under Jest `canUseGlass` is true, so this renders the platform's own
  // Liquid Glass material and paints no colour of its own. The blur and
  // opaque fallbacks — which do change — are covered by GlassSurface.test.
  'GlassSurface',
  // `@shopify/react-native-skia` is a structural double that renders a
  // `Path`'s children only (`packages/config/jest.native-mocks.js`), so a
  // `color` prop never reaches the tree.
  'LineChart',
  'Sparkline',
  'ProgressRing',
  // `@gorhom/bottom-sheet` is a passthrough double that never calls
  // `backgroundComponent` nor applies `handleIndicatorStyle`.
  'Sheet',
]);

describe('every primitive renders scheme-correct colours', () => {
  it('has a dark-only set worth asserting against', () => {
    // Sanity: if the two schemes ever converge, the guard below passes
    // vacuously and stops meaning anything.
    expect(DARK_ONLY.length).toBeGreaterThan(20);
  });

  it.each(Object.keys(SPECIMENS))('%s emits no dark-only colour under scheme="light"', (name) => {
    const specimen = SPECIMENS[name];
    if (!specimen) throw new Error(`no specimen for ${name}`);
    const tree = render(mount(specimen, 'light')).toJSON();
    const emitted = new Set<string | number>();
    collectColours(tree as unknown as Json, emitted);

    const leaked = [...emitted].filter((value) => DARK_ONLY_PROCESSED.has(value));
    expect(leaked).toEqual([]);
  });

  it.each(Object.keys(SPECIMENS).filter((name) => !NO_OBSERVABLE_DIFFERENCE.has(name)))(
    '%s emits a different colour set per scheme',
    (name) => {
      const specimen = SPECIMENS[name];
      if (!specimen) throw new Error(`no specimen for ${name}`);
      const emitted = (scheme: 'dark' | 'light') => {
        const set = new Set<string | number>();
        collectColours(render(mount(specimen, scheme)).toJSON() as unknown as Json, set);
        return set;
      };
      const dark = emitted('dark');
      const light = emitted('light');
      // A specimen whose two renders are identical is either colourless or
      // still baked. The exempt list above says which, one by one.
      expect([...dark].filter((value) => !light.has(value)).length).toBeGreaterThan(0);
    },
  );

  it('exempts nothing that is not still in the specimen list', () => {
    for (const name of NO_OBSERVABLE_DIFFERENCE) expect(SPECIMENS[name]).toBeDefined();
  });
});

// ── 3. No component reads a scheme-dependent group at module scope ───────

const SCHEME_DEPENDENT = [
  'colors',
  'elevation',
  'glass',
  'control',
  'dataviz',
  'selectionPill',
  'skeleton',
  'scrim',
];

/**
 * The one file allowed to import a scheme-dependent group at module scope,
 * and why — the same shape of allowlist `packages/config/eslint.react-native.js`
 * uses for `theme/no-raw-color`, and for the same reason: an entry someone
 * can read and challenge in review, never an inline disable.
 *
 * `GlassSurface` names `colors.state.*` and `colors.urgent` in order to
 * REJECT them as a white-label tint at the TYPE level, which needs literal
 * types and therefore a module-scope constant. It renders none of them —
 * every colour it paints comes from `useTheme()`.
 *
 * `avatar-fallback.ts` holds the DARK fallback palette as the default
 * argument of a pure function. It renders nothing; `Avatar` builds the
 * active scheme's palette and passes it in.
 */
const ALLOWED = new Set(['surfaces/GlassSurface.tsx', 'components/avatar-fallback.ts']);

function sourceFiles(): string[] {
  const root = join(__dirname, '..');
  const out: string[] = [];
  for (const dir of ['components', 'surfaces', 'toast']) {
    for (const entry of readdirSync(join(root, dir))) {
      if (!/\.tsx?$/.test(entry) || entry.includes('.test.')) continue;
      out.push(`${dir}/${entry}`);
    }
  }
  return out;
}

describe('no component imports a scheme-dependent token group at module scope', () => {
  it.each(sourceFiles())('%s', (relativePath) => {
    const source = readFileSync(join(__dirname, '..', relativePath), 'utf8');
    const imports = source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'[^']*tokens\.ts'/g);
    const named: string[] = [];
    for (const match of imports) {
      for (const raw of (match[1] ?? '').split(',')) {
        const specifier = raw.trim();
        if (!specifier || specifier.startsWith('type ')) continue;
        // `skeleton as skeletonTokens` — the local name is irrelevant, the
        // imported one is what matters.
        named.push(specifier.split(/\s+as\s+/)[0]?.trim() ?? '');
      }
    }
    const offending = named.filter((name) => SCHEME_DEPENDENT.includes(name));
    if (ALLOWED.has(relativePath)) return;
    expect(offending).toEqual([]);
  });

  it('keeps the allowlist honest — every entry still needs its exemption', () => {
    for (const relativePath of ALLOWED) {
      const source = readFileSync(join(__dirname, '..', relativePath), 'utf8');
      expect(source).toMatch(/from '[^']*tokens\.ts'/);
    }
  });
});
