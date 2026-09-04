import { act, render, screen } from '@testing-library/react-native';
import {
  AccessibilityInfo,
  ActivityIndicator,
  StyleSheet,
  type DimensionValue,
  type EmitterSubscription,
  type ViewStyle,
} from 'react-native';

import { density } from '../theme/tokens.ts';

import { LoadingState } from './LoadingState.tsx';

/** `Skeleton` reads Reduce Motion asynchronously; settle it rather than leak the update. */
function mockReduceMotion(): void {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => {
    return { remove: jest.fn() } as unknown as EmitterSubscription;
  }) as typeof AccessibilityInfo.addEventListener);
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

/** Skeletons are hidden from the accessibility tree by design, so every query opts in. */
function byTestId(testID: string) {
  return screen.getByTestId(testID, { includeHiddenElements: true });
}

function childHeights(testID: string): (DimensionValue | undefined)[] {
  return byTestId(testID).children.map((child) =>
    typeof child === 'string'
      ? undefined
      : StyleSheet.flatten(child.props.style as ViewStyle | undefined)?.height,
  );
}

describe('LoadingState', () => {
  beforeEach(() => {
    mockReduceMotion();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // `DESIGN.md` §5 / `UI-UX.md` §UX6.3 rule 15 — never a spinner where a
  // skeleton belongs, at any shape.
  it.each(['list', 'detail', 'card'] as const)(
    'draws skeletons and no spinner (%s)',
    async (shape) => {
      render(<LoadingState shape={shape} accessibilityLabel="Loading clients" testID="region" />);
      await settle();

      const spinners = screen.root.findAll((node) => node.type === ActivityIndicator);

      expect(spinners).toHaveLength(0);
      expect(screen.getAllByRole('progressbar').length).toBeGreaterThan(0);
    },
  );

  // `accessibility` §2 — the block reads as one busy item, not twenty
  // fragments.
  it.each(['list', 'detail', 'card'] as const)(
    'announces the region exactly once (%s)',
    async (shape) => {
      render(<LoadingState shape={shape} accessibilityLabel="Loading clients" />);
      await settle();

      expect(screen.getAllByRole('progressbar')).toHaveLength(1);
      expect(screen.getByLabelText('Loading clients').props.accessibilityState).toEqual({
        busy: true,
      });
    },
  );

  it('renders one row per requested row', async () => {
    render(<LoadingState rows={5} accessibilityLabel="Loading clients" testID="region" />);
    await settle();

    expect(byTestId('region').children).toHaveLength(5);
  });

  // `DESIGN.md` §9's list row is a density pair (66 client / 56 coach), and
  // a skeleton that does not reserve the real height shifts the layout when
  // the data lands (`UI-UX.md` §UX5.1).
  it('reserves the real row height at both densities', async () => {
    render(<LoadingState rows={3} accessibilityLabel="Loading clients" testID="region" />);
    await settle();
    expect(childHeights('region')).toEqual([
      density.client.row,
      density.client.row,
      density.client.row,
    ]);

    screen.unmount();

    render(
      <LoadingState
        rows={3}
        density="coach"
        accessibilityLabel="Loading clients"
        testID="region"
      />,
    );
    await settle();
    expect(childHeights('region')).toEqual([
      density.coach.row,
      density.coach.row,
      density.coach.row,
    ]);
  });

  it('always renders at least one row', async () => {
    render(<LoadingState rows={0} accessibilityLabel="Loading clients" testID="region" />);
    await settle();

    expect(byTestId('region').children).toHaveLength(1);
  });
});
