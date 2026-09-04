import { render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';

import { colors } from '../theme/tokens.ts';

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
