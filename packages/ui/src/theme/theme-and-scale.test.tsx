import { render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Dimensions, StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';

import { AdherenceDot } from '../components/AdherenceDot.tsx';
import { AdherenceDotRow } from '../components/AdherenceDotRow.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { AvatarStack } from '../components/AvatarStack.tsx';
import { Badge } from '../components/Badge.tsx';
import { Button } from '../components/Button.tsx';
import { Calendar } from '../components/Calendar.tsx';
import { Card } from '../components/Card.tsx';
import { CHART_MIN_SPAN } from '../components/chartDomain.ts';
import { Chip } from '../components/Chip.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { ForbiddenState } from '../components/ForbiddenState.tsx';
import { FormField } from '../components/FormField.tsx';
import { Input } from '../components/Input.tsx';
import { LineChart } from '../components/LineChart.tsx';
import { LoadingState } from '../components/LoadingState.tsx';
import { MacroBar } from '../components/MacroBar.tsx';
import { Metric } from '../components/Metric.tsx';
import { NotFoundState } from '../components/NotFoundState.tsx';
import { NumberStepper } from '../components/NumberStepper.tsx';
import { ProgressRing } from '../components/ProgressRing.tsx';
import { SegmentedControl } from '../components/SegmentedControl.tsx';
import { SheetHeader } from '../components/SheetHeader.tsx';
import { SkeletonText } from '../components/SkeletonText.tsx';
import { Sparkline } from '../components/Sparkline.tsx';
import { Text } from '../components/Text.tsx';

import { schemes, type Scheme } from './schemes.ts';
import { TextScaleProvider } from './TextScaleProvider.tsx';
import { ThemeProvider } from './ThemeProvider.tsx';
import { fontSize } from './tokens.ts';

/**
 * `component-gallery/02`'s pass, as a test rather than as a memory of having
 * looked. The gallery renders these same primitives behind a scheme toggle and
 * a text-scale toggle; what a human eye catches there, this catches on every
 * push — and catches it for a primitive added after the pass was run.
 */

const noop = () => {};

// One specimen per text-bearing primitive, at the variant most likely to break:
// the one whose text sits inside a box the design gives a fixed size.
const SPECIMENS: readonly { name: string; render: () => ReactElement }[] = [
  { name: 'Text', render: () => <Text size="body">Rest 90 seconds</Text> },
  { name: 'Metric', render: () => <Metric value={1240} unit="kcal" size="stat" /> },
  {
    name: 'Button/primary',
    render: () => <Button onPress={noop}>Log the whole session</Button>,
  },
  {
    name: 'Button/sm',
    render: () => (
      <Button size="sm" variant="secondary" onPress={noop}>
        Duplicate week
      </Button>
    ),
  },
  { name: 'Chip', render: () => <Chip label="Dumbbells only" selected onPress={noop} /> },
  {
    name: 'SegmentedControl',
    render: () => (
      <SegmentedControl
        options={[
          { value: 'week', label: 'This week' },
          { value: 'month', label: 'This month' },
        ]}
        value="week"
        onChange={noop}
      />
    ),
  },
  { name: 'Badge/count', render: () => <Badge count={12} tone="brand" size="sm" /> },
  { name: 'Badge/label', render: () => <Badge label="New" size="md" /> },
  { name: 'Avatar', render: () => <Avatar name="Priya Nair" userId="u1" size="xs" /> },
  {
    name: 'AvatarStack',
    render: () => (
      <AvatarStack
        people={[
          { name: 'Priya Nair', userId: 'u1' },
          { name: 'Sam Doe', userId: 'u2' },
        ]}
        max={1}
        size="xs"
      />
    ),
  },
  { name: 'Card', render: () => <Card>{<Text>Tuesday · Lower body</Text>}</Card> },
  {
    name: 'Input',
    render: () => <Input value="82.5" onChangeText={noop} accessibilityLabel="Body weight" />,
  },
  {
    name: 'FormField',
    render: () => (
      <FormField label="Body weight" error="Enter a number between 20 and 400">
        <Input value="" onChangeText={noop} />
      </FormField>
    ),
  },
  {
    name: 'NumberStepper',
    render: () => (
      <NumberStepper
        value={62.5}
        step={2.5}
        max={300}
        onChange={noop}
        unit="kg"
        accessibilityLabel="Working weight"
      />
    ),
  },
  { name: 'ProgressRing', render: () => <ProgressRing value={1240} target={2100} unit="kcal" /> },
  { name: 'MacroBar', render: () => <MacroBar proteinG={140} carbsG={210} fatG={70} /> },
  {
    name: 'AdherenceDotRow',
    render: () => (
      <AdherenceDotRow days={[]} metric="training" todayISO="2026-08-16" showDayLabels />
    ),
  },
  { name: 'AdherenceDot', render: () => <AdherenceDot state="on-track" /> },
  {
    name: 'Calendar',
    render: () => (
      <Calendar
        initialMonth="2026-08-01"
        today="2026-08-16"
        selected="2026-08-16"
        onSelect={noop}
      />
    ),
  },
  {
    name: 'LineChart',
    render: () => (
      <LineChart
        series={[
          {
            label: 'Weight',
            unit: 'kg',
            minSpan: CHART_MIN_SPAN.bodyWeightKg,
            points: [
              { dateISO: '2026-08-10', value: 83.1 },
              { dateISO: '2026-08-13', value: 82.6 },
              { dateISO: '2026-08-16', value: 82.4 },
            ],
          },
        ]}
      />
    ),
  },
  {
    name: 'Sparkline',
    render: () => (
      <Sparkline
        points={[
          { dateISO: '2026-08-10', value: 60 },
          { dateISO: '2026-08-16', value: 65 },
        ]}
        accessibilityLabel="Bench press working weight"
      />
    ),
  },
  { name: 'SkeletonText', render: () => <SkeletonText size="body" lines={2} /> },
  { name: 'LoadingState', render: () => <LoadingState rows={2} accessibilityLabel="Loading" /> },
  {
    name: 'EmptyState',
    render: () => (
      <EmptyState
        title="No clients yet"
        body="Invite someone and their week shows up here."
        primaryAction={{ label: 'Invite your first client', onPress: noop }}
      />
    ),
  },
  { name: 'NotFoundState', render: () => <NotFoundState onRecover={noop} /> },
  { name: 'ForbiddenState', render: () => <ForbiddenState onRecover={noop} /> },
  // `SheetFooter` is not here: it reads the safe-area inset, so it needs a
  // `SafeAreaProvider` around it, and its only text is a `Button` label —
  // covered above. `Sheet`/`Modal` likewise render through a portal.
  { name: 'SheetHeader', render: () => <SheetHeader title="Add an exercise" onClose={noop} /> },
];

/**
 * The one sanctioned exception to the rule below, and why. `accessibility` §3
 * gives two answers to "text inside a fixed box": grow the box, or cap the
 * text's scale. `ProgressRing` takes a third that is really the first —
 * it grows its own diameter with the text scale (`useBoxTextScale`), so its
 * box is fixed only within one render.
 */
const GROWS_ITS_OWN_BOX = new Set(['ProgressRing']);

type StyledNode = { type: unknown; props: { style?: unknown }; parent: StyledNode | null };

function flattenStyle(node: StyledNode): (ViewStyle & TextStyle) | undefined {
  return StyleSheet.flatten(node.props.style as ViewStyle | undefined);
}

/**
 * `accessibility` §3's first failure mode, checked mechanically: "fixed-height
 * rows clip at 200%. Min-height, not height. Let rows grow."
 *
 * A host `View` with a numeric `height` somewhere above a `Text` cannot grow
 * when that text doubles, so the text is cut off — unless the text caps its own
 * scale with `maxFontSizeMultiplier`, which is §3's other sanctioned answer.
 */
function fixedHeightBoxesAroundText(root: StyledNode): string[] {
  const offenders: string[] = [];

  function walk(node: StyledNode, fixedHeights: number[]) {
    const style = typeof node.type === 'string' ? flattenStyle(node) : undefined;
    const nextHeights =
      typeof style?.height === 'number' ? [...fixedHeights, style.height] : fixedHeights;

    if (node.type === 'Text' && nextHeights.length > 0) {
      const capped = typeof flattenStyleCap(node) === 'number';
      if (!capped) offenders.push(`height=${nextHeights.join(',')}`);
    }

    for (const child of childrenOf(node)) walk(child, nextHeights);
  }

  walk(root, []);
  return offenders;
}

function flattenStyleCap(node: StyledNode): unknown {
  const props: Record<string, unknown> = node.props;
  return props.maxFontSizeMultiplier;
}

function childrenOf(node: StyledNode): StyledNode[] {
  const children: unknown = (node as { children?: unknown }).children;
  return Array.isArray(children) ? children.filter(isStyledNode) : [];
}

function isStyledNode(value: unknown): value is StyledNode {
  return typeof value === 'object' && value !== null && 'props' in value && 'type' in value;
}

function reservedLineBox(testID: string): number {
  const [row] = screen.getByTestId(testID).children;
  if (!isStyledNode(row)) throw new Error('expected a row view');
  const height = flattenStyle(row)?.height;
  if (typeof height !== 'number') throw new Error('expected a reserved line box');
  return height;
}

function rootOf(): StyledNode {
  const root: unknown = screen.UNSAFE_root;
  if (!isStyledNode(root)) throw new Error('expected a rendered root');
  return root;
}

function renderIn(scheme: Scheme, scale: number, element: ReactElement) {
  return render(
    <ThemeProvider scheme={scheme}>
      <TextScaleProvider scale={scale}>{element}</TextScaleProvider>
    </ThemeProvider>,
  );
}

describe('every primitive, both schemes, 100% and 200% text', () => {
  for (const specimen of SPECIMENS) {
    for (const scheme of ['dark', 'light'] as const) {
      for (const scale of [1, 2]) {
        it(`${specimen.name} renders in ${scheme} at ${scale * 100}%`, () => {
          expect(() => renderIn(scheme, scale, specimen.render())).not.toThrow();
        });
      }
    }
  }
});

describe('no primitive boxes text into a height it cannot grow out of', () => {
  for (const specimen of SPECIMENS) {
    if (GROWS_ITS_OWN_BOX.has(specimen.name)) continue;

    it(`${specimen.name} sizes every text container with minHeight, not height`, () => {
      renderIn('dark', 2, specimen.render());
      expect(fixedHeightBoxesAroundText(rootOf())).toEqual([]);
    });
  }
});

describe('the 200% toggle reaches every kind of text', () => {
  it('doubles a Text primitive', () => {
    renderIn('dark', 2, <Text size="body">Rest 90 seconds</Text>);
    const style = StyleSheet.flatten(screen.getByText('Rest 90 seconds').props.style as TextStyle);

    expect(style.fontSize).toBe(fontSize.body[0] * 2);
    expect(style.lineHeight).toBe(Number.parseFloat(fontSize.body[1].lineHeight) * 2);
  });

  // `Input` and `NumberStepper` render a raw `TextInput`, which tracks the OS
  // font setting but knows nothing about the gallery's toggle — the gap
  // `component-gallery/01` flagged, closed in the components themselves.
  it("doubles Input's TextInput, which does not route through Text", () => {
    renderIn('dark', 2, <Input value="82.5" onChangeText={noop} accessibilityLabel="Weight" />);
    const style = StyleSheet.flatten(screen.getByLabelText('Weight').props.style as TextStyle);

    expect(style.fontSize).toBe(fontSize['body-lg'][0] * 2);
  });

  // A skeleton is a box with no text in it, so nothing scales it implicitly —
  // it has to track the scale itself or the page jumps when the real text
  // lands. React Native's jest preset already mocks the OS `fontScale` at 2,
  // which is `MAX_BOX_TEXT_SCALE`, so both toggle positions saturate the cap
  // here — and asserting the cap is the point: past 2x a box stops growing
  // rather than outgrowing the phone (`accessibility` §3).
  it('reserves the line box at the effective text scale, capped at 2x', () => {
    const lineBox = Number.parseInt(fontSize.body[1].lineHeight, 10);

    for (const scale of [1, 2]) {
      renderIn('dark', scale, <SkeletonText size="body" lines={1} testID="skeleton" />);
      const expected = lineBox * Math.min(Dimensions.get('window').fontScale * scale, 2);
      expect(reservedLineBox('skeleton')).toBe(Math.round(expected));
      screen.unmount();
    }
  });

  // The two sanctioned caps: an avatar circle cannot grow, so its initials stop
  // scaling at the point they would be clipped rather than growing into nothing.
  it('caps the initials in an avatar rather than clipping or freezing them', () => {
    renderIn('dark', 2, <Avatar name="Priya Nair" userId="u1" size="xs" />);
    const initials = screen.getByText('PN', { includeHiddenElements: true });
    const style = StyleSheet.flatten(initials.props.style as TextStyle);

    const cap: unknown = initials.props.maxFontSizeMultiplier;
    if (typeof cap !== 'number') throw new Error('expected a cap on the initials');

    expect(cap).toBeGreaterThan(1);
    expect(cap).toBeLessThan(2);
    expect(style.fontSize).toBe(fontSize.micro[0] * cap);
  });
});

describe('the scheme actually changes the colours it resolves', () => {
  it('gives every background and foreground role a different value per scheme', () => {
    for (const role of ['outer', 'DEFAULT', 'raised', 'inset'] as const) {
      expect(schemes.light.bg[role]).not.toBe(schemes.dark.bg[role]);
    }
    for (const role of ['bright', 'DEFAULT', 'muted', 'subtle'] as const) {
      expect(schemes.light.fg[role]).not.toBe(schemes.dark.fg[role]);
    }
  });

  // DESIGN.md §1.1 — the primary fill is the same peach gradient in both
  // schemes, so the ink on it is the same dark `onBrand` in both. A scheme
  // that flipped this to white would land at 2.6:1.
  it('keeps the ink on the primary fill scheme-invariant', () => {
    expect(schemes.light.fg.onBrand).toBe(schemes.dark.fg.onBrand);
  });

  it('renders a brand badge in the dark onBrand ink, never the light body ink', () => {
    renderIn('dark', 1, <Badge count={3} tone="brand" />);
    // The badge is hidden from the reading order by design — the consumer
    // folds the count into its own label (`Badge`'s accessibility contract).
    const classes: unknown = screen.getByText('3', { includeHiddenElements: true }).props.className;

    expect(typeof classes).toBe('string');
    expect(String(classes)).toContain('text-fg-onBrand');
  });
});

describe('a View outside a ThemeProvider still renders', () => {
  it('does not require the provider to render a primitive', () => {
    expect(() =>
      render(
        <View>
          <Text>Standalone</Text>
        </View>,
      ),
    ).not.toThrow();
  });
});
