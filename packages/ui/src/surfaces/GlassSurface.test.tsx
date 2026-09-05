import { render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Platform, StyleSheet } from 'react-native';

import { colors, elevation, glass } from '../theme/tokens.ts';

import { GlassSurface } from './GlassSurface.tsx';

const mockIsLiquidGlassAvailable = jest.fn(() => false);

jest.mock('expo-glass-effect', () => {
  const RN = jest.requireActual('react-native');
  return {
    GlassView: ({ children, ...props }: Record<string, unknown>) => (
      <RN.View testID="glass-view" {...props}>
        {children as React.ReactNode}
      </RN.View>
    ),
    GlassContainer: ({ children, ...props }: Record<string, unknown>) => (
      <RN.View testID="glass-container" {...props}>
        {children as React.ReactNode}
      </RN.View>
    ),
    isLiquidGlassAvailable: () => mockIsLiquidGlassAvailable(),
  };
});

jest.mock('expo-blur', () => {
  const RN = jest.requireActual('react-native');
  return {
    BlurView: ({ children, ...props }: Record<string, unknown>) => (
      <RN.View testID="blur-view" {...props}>
        {children as React.ReactNode}
      </RN.View>
    ),
  };
});

jest.mock('expo-linear-gradient', () => {
  const RN = jest.requireActual('react-native');
  return {
    LinearGradient: ({ children, ...props }: Record<string, unknown>) => (
      <RN.View testID="linear-gradient" {...props}>
        {children as React.ReactNode}
      </RN.View>
    ),
  };
});

function setPlatform(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
}

describe('GlassSurface', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    setPlatform('ios');
  });

  it('renders real Liquid Glass on iOS 26+ with transparency allowed', async () => {
    setPlatform('ios');
    mockIsLiquidGlassAvailable.mockReturnValue(true);
    jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'isDarkerSystemColorsEnabled').mockResolvedValue(false);

    render(<GlassSurface tier="tier2" />);

    expect(await screen.findByTestId('glass-view')).toBeTruthy();
    expect(screen.queryByTestId('blur-view')).toBeNull();
  });

  it('renders the blur fallback on Android (not Liquid Glass capable, transparency allowed)', async () => {
    setPlatform('android');
    mockIsLiquidGlassAvailable.mockReturnValue(false);
    jest.spyOn(AccessibilityInfo, 'isHighTextContrastEnabled').mockResolvedValue(false);

    render(<GlassSurface tier="tier1" testID="surface" />);

    expect(await screen.findByTestId('blur-view')).toBeTruthy();
    expect(screen.queryByTestId('glass-view')).toBeNull();
  });

  it('renders the opaque fallback when Reduce Transparency is on, even on capable hardware', async () => {
    setPlatform('ios');
    mockIsLiquidGlassAvailable.mockReturnValue(true);
    jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockResolvedValue(true);
    jest.spyOn(AccessibilityInfo, 'isDarkerSystemColorsEnabled').mockResolvedValue(false);

    render(<GlassSurface tier="tier2" testID="surface" />);

    // No glass, no blur — the opaque `elevation.raised` fallback only.
    await screen.findByTestId('surface');
    expect(screen.queryByTestId('glass-view')).toBeNull();
    expect(screen.queryByTestId('blur-view')).toBeNull();
  });

  it('renders the opaque fallback when Increase Contrast is on, even on capable hardware', async () => {
    setPlatform('ios');
    mockIsLiquidGlassAvailable.mockReturnValue(true);
    jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'isDarkerSystemColorsEnabled').mockResolvedValue(true);

    render(<GlassSurface tier="tier2" testID="surface" />);

    await screen.findByTestId('surface');
    expect(screen.queryByTestId('glass-view')).toBeNull();
    expect(screen.queryByTestId('blur-view')).toBeNull();
  });

  it('clamps a white-label tint to a low-opacity rgba overlay', async () => {
    setPlatform('ios');
    mockIsLiquidGlassAvailable.mockReturnValue(true);
    jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'isDarkerSystemColorsEnabled').mockResolvedValue(false);

    render(<GlassSurface tier="tier2" tint="#3355FF" />);

    const glassView = await screen.findByTestId('glass-view');
    expect(glassView.props.tintColor).toBe('rgba(51, 85, 255, 0.14)');
  });

  it('rejects an adherence colour as a tint', () => {
    setPlatform('ios');
    mockIsLiquidGlassAvailable.mockReturnValue(true);
    jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'isDarkerSystemColorsEnabled').mockResolvedValue(false);

    expect(() =>
      render(
        // @ts-expect-error — `GlassTint` rejects a literal adherence hue at the type level too.
        <GlassSurface tier="tier2" tint={colors.urgent} />,
      ),
    ).toThrow(/adherence colour/);
  });
});

// ── The outer drop (DESIGN.md §4, §9's Dock row) ─────────────────────────
//
// It is owned here rather than at each call site, and the reason it has to
// be asserted on all three paths is that the naive fix is silently wrong:
// `overflow: 'hidden'` is `clipsToBounds` on iOS and suppresses the view's
// own shadow, so a drop added to the view that clips the material renders
// on iOS 26 and vanishes everywhere else. Two dock tasks hit exactly that.

/** iOS 26+ hardware, no accessibility override — the real Liquid Glass path. */
function allowLiquidGlass() {
  setPlatform('ios');
  mockIsLiquidGlassAvailable.mockReturnValue(true);
  jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'isDarkerSystemColorsEnabled').mockResolvedValue(false);
}

/** Android — no Liquid Glass, transparency still allowed: the blur path. */
function forceBlurFallback() {
  setPlatform('android');
  mockIsLiquidGlassAvailable.mockReturnValue(false);
  jest.spyOn(AccessibilityInfo, 'isHighTextContrastEnabled').mockResolvedValue(false);
}

/** Capable hardware with Reduce Transparency on — the opaque path. */
function forceOpaqueFallback() {
  setPlatform('ios');
  mockIsLiquidGlassAvailable.mockReturnValue(true);
  jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isDarkerSystemColorsEnabled').mockResolvedValue(false);
}

/**
 * The surface's own style, read AFTER `useGlassAvailable`'s two async
 * accessibility reads have settled. The node is re-queried rather than
 * reused: the first render can resolve a different path entirely, and the
 * instance returned by `findBy*` is unmounted by the time it does.
 */
async function settledSurfaceStyle(testID: string) {
  await screen.findByTestId(testID);
  return StyleSheet.flatten(screen.getByTestId(testID).props.style);
}

/** The absolutely-filled layer that holds the material, inside the surface. */
function clipLayerStyle(testID: string) {
  const [clip] = screen.getByTestId(testID).children;
  if (clip === undefined || typeof clip === 'string') {
    throw new Error('GlassSurface rendered no clip layer.');
  }
  return StyleSheet.flatten(clip.props.style);
}

describe('GlassSurface — the tier drop shadow', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    setPlatform('ios');
  });

  it('renders the tier drop on the Liquid Glass path', async () => {
    allowLiquidGlass();

    render(<GlassSurface tier="tier1" testID="surface" />);

    expect(await settledSurfaceStyle('surface')).toMatchObject(glass.tier1.shadow);
  });

  it('renders the tier drop on the blur fallback', async () => {
    forceBlurFallback();

    render(<GlassSurface tier="tier1" testID="surface" />);

    expect(await settledSurfaceStyle('surface')).toMatchObject(glass.tier1.shadow);
  });

  it('never clips on the view that carries the shadow', async () => {
    forceBlurFallback();

    render(<GlassSurface tier="tier1" testID="surface" />);

    // The whole bug: `overflow: 'hidden'` here is `clipsToBounds` on iOS and
    // suppresses this view's own drop.
    expect((await settledSurfaceStyle('surface')).overflow).toBeUndefined();
  });

  it('clips the material one layer in, wearing the surface radius', async () => {
    forceBlurFallback();

    render(<GlassSurface tier="tier1" testID="surface" style={{ borderRadius: 32 }} />);

    // The blur, the gradient and both hairlines still have to be clipped to
    // the surface's corners — the boundary moved inward, it did not go away.
    await screen.findByTestId('blur-view');
    const style = clipLayerStyle('surface');
    expect(style.overflow).toBe('hidden');
    expect(style.borderRadius).toBe(32);
  });

  it('takes its own L2 drop on the opaque path, not the glass one', async () => {
    forceOpaqueFallback();

    render(<GlassSurface tier="tier1" testID="surface" />);

    // Reduce Transparency renders a different MATERIAL (DESIGN.md §2's L2),
    // so it takes L2's shorter drop rather than §4's translucent-calibrated
    // one — but it still floats.
    const style = await settledSurfaceStyle('surface');
    expect(style).toMatchObject(elevation.raised.shadow);
    expect(style.shadowRadius).not.toBe(glass.tier1.shadow.shadowRadius);
  });

  it('gives tier 3 no outer shadow on any path', async () => {
    // §4 gives the chip / avatar / floating icon button an inset highlight
    // and nothing else. An absent shadow, never a zeroed one — and the tier,
    // not the material, is what decides that, so the opaque fallback must
    // not grow one either.
    for (const setPath of [allowLiquidGlass, forceBlurFallback, forceOpaqueFallback]) {
      setPath();
      const view = render(<GlassSurface tier="tier3" testID="surface" />);

      const style = await settledSurfaceStyle('surface');
      expect(style.shadowOpacity).toBeUndefined();
      expect(style.elevation).toBeUndefined();

      view.unmount();
      jest.restoreAllMocks();
    }
  });

  it('still lands a caller style on the surface itself', async () => {
    // A wrapper placed OUTSIDE the clip would have had to swallow `style` to
    // position itself, which would move the auth nav bar's status-bar
    // padding and both docks' absolute insets off the surface they belong
    // to. Every existing call site depends on them landing here.
    forceBlurFallback();

    render(
      <GlassSurface
        tier="tier1"
        testID="surface"
        style={{ position: 'absolute', bottom: 26, left: 16, right: 16, paddingTop: 44 }}
      />,
    );

    expect(await settledSurfaceStyle('surface')).toMatchObject({
      position: 'absolute',
      bottom: 26,
      left: 16,
      right: 16,
      paddingTop: 44,
    });
  });
});
