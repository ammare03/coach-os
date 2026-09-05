import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Dimensions, type EmitterSubscription } from 'react-native';

import { fontSize } from '../theme/tokens.ts';

import { Skeleton } from './Skeleton.tsx';
import { SkeletonCircle } from './SkeletonCircle.tsx';
import { SkeletonText } from './SkeletonText.tsx';

type ReduceMotionListener = (enabled: boolean) => void;

/**
 * Reduce Motion is read asynchronously and then subscribed to, so every
 * test here has to settle that promise before asserting — and one of them
 * needs the listener to flip it at runtime, which is the case the
 * `accessibility` skill §5 says is the one usually got wrong.
 */
function mockReduceMotion(initial: boolean): { emit: ReduceMotionListener } {
  const listeners: ReduceMotionListener[] = [];
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(initial);
  // `addEventListener` is overloaded per event name; the cast picks the
  // `reduceMotionChanged` shape rather than the first overload TS infers.
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((
    event: string,
    handler: ReduceMotionListener,
  ) => {
    if (event === 'reduceMotionChanged') listeners.push(handler);
    return { remove: jest.fn() } as unknown as EmitterSubscription;
  }) as typeof AccessibilityInfo.addEventListener);
  return {
    emit: (enabled) => {
      for (const listener of listeners) listener(enabled);
    },
  };
}

/** A skeleton is hidden from the accessibility tree by design, so every query has to opt in. */
function byTestId(testID: string) {
  return screen.getByTestId(testID, { includeHiddenElements: true });
}

/** `onLayout` never fires in a test renderer; the sweep only starts once a width is known. */
function giveWidth(testID: string, width = 200) {
  act(() => {
    byTestId(testID).props.onLayout({ nativeEvent: { layout: { width, height: 12 } } });
  });
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('Skeleton', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sweeps once a width is measured', async () => {
    mockReduceMotion(false);
    render(<Skeleton height={12} testID="sk" />);
    await settle();

    expect(byTestId('sk').children).toHaveLength(0);

    giveWidth('sk');

    expect(byTestId('sk').children).toHaveLength(1);
  });

  it('renders a static placeholder when Reduce Motion is on', async () => {
    mockReduceMotion(true);
    render(<Skeleton height={12} testID="sk" />);
    await settle();
    giveWidth('sk');

    // The shape is still there — only the movement is gone.
    expect(byTestId('sk')).toBeTruthy();
    expect(byTestId('sk').children).toHaveLength(0);
  });

  it('drops the sweep when Reduce Motion is switched on at runtime', async () => {
    const { emit } = mockReduceMotion(false);
    render(<Skeleton height={12} testID="sk" />);
    await settle();
    giveWidth('sk');
    expect(byTestId('sk').children).toHaveLength(1);

    act(() => emit(true));

    expect(byTestId('sk').children).toHaveLength(0);
  });

  it('is hidden from the screen reader unless it is given a label', async () => {
    mockReduceMotion(false);
    render(<Skeleton height={12} testID="sk" />);
    await settle();

    const bare = byTestId('sk');
    expect(bare.props.accessible).toBe(false);
    expect(bare.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('announces the region as busy when it is given a label', async () => {
    mockReduceMotion(false);
    render(<Skeleton height={12} accessibilityLabel="Loading clients" testID="sk" />);
    await settle();

    const labelled = screen.getByLabelText('Loading clients');
    expect(labelled.props.accessibilityRole).toBe('progressbar');
    expect(labelled.props.accessibilityState).toEqual({ busy: true });
  });
});

describe('SkeletonText', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The box tracks the text scale, because the whole contract is that
  // swapping this for real `Text` shifts nothing — and real `Text` is twice
  // the size at 200% (`accessibility` §3). React Native's jest preset mocks
  // `fontScale` at 2, so that is the multiplier under test here.
  it('reserves the full line box of the size it stands in for, at the current text scale', async () => {
    mockReduceMotion(false);
    render(<SkeletonText size="body" lines={3} testID="text" />);
    await settle();

    const [glyphHeight, metrics] = fontSize.body;
    const scale = Dimensions.get('window').fontScale;
    const rows = byTestId('text').children;

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      if (typeof row === 'string') throw new Error('expected a row view');
      expect(row.props.style.height).toBe(
        Math.round(Number.parseInt(metrics.lineHeight, 10) * scale),
      );
      expect(row.props.style.height).toBeGreaterThan(glyphHeight * scale);
    }
  });

  it('narrows only the last line when a ragged width is asked for', async () => {
    mockReduceMotion(false);
    render(<SkeletonText lines={2} lastLineWidth="62%" testID="text" />);
    await settle();

    // Only a `Skeleton` root carries `onLayout`, so this is one node per line.
    const widths = screen.root
      .findAll((node) => typeof node.type === 'string' && node.props.onLayout !== undefined)
      .map((node) => node.props.style.find((entry: unknown) => isWidthStyle(entry))?.width);

    expect(widths).toEqual(['100%', '62%']);
  });

  it('labels only the first line, so a paragraph reads as one item', async () => {
    mockReduceMotion(false);
    render(<SkeletonText lines={3} accessibilityLabel="Loading the session note" />);
    await settle();

    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  });
});

describe('SkeletonCircle', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is square and fully rounded at the diameter it is given', async () => {
    mockReduceMotion(false);
    render(<SkeletonCircle diameter={48} testID="circle" />);
    await settle();

    const style = byTestId('circle').props.style.find((entry: unknown) => isWidthStyle(entry));

    expect(style.width).toBe(48);
    expect(style.height).toBe(48);
    expect(style.borderRadius).toBe(999);
  });
});

function isWidthStyle(entry: unknown): entry is { width: unknown } {
  return typeof entry === 'object' && entry !== null && 'width' in entry;
}
