import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ThemeProvider } from './ThemeProvider.tsx';
import { darkSchemeTokens } from './tokens.ts';
import { DEFAULT_THEME, useTheme } from './useTheme.ts';

function Probe() {
  const theme = useTheme();
  return <Text testID="probe">{`${theme.scheme}:${theme.colors.brand.DEFAULT}`}</Text>;
}

describe('useTheme', () => {
  // Was "throws outside a ThemeProvider" until `component-gallery/04`.
  // The throw is what kept `useTheme()` at zero consumers and left every
  // JS-set colour baked to the dark table; a hook that throws is not a
  // usable escape hatch. Dark is the same answer `ThemeProvider` gives with
  // no props, so the default is not a guess.
  it('returns the dark scheme outside a ThemeProvider', () => {
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('probe').props.children).toBe('dark:#FFA586');
  });

  it('gives a bare component the dark derivation of every scheme-dependent group', () => {
    expect(DEFAULT_THEME.control.surface).toBe(darkSchemeTokens.control.surface);
    expect(DEFAULT_THEME.elevation.raised.gradient).toEqual(
      darkSchemeTokens.elevation.raised.gradient,
    );
    expect(DEFAULT_THEME.scrim.color).toBe(darkSchemeTokens.scrim.color);
  });

  it('defaults to the dark scheme with no props', () => {
    const { getByTestId } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(getByTestId('probe').props.children).toBe('dark:#FFA586');
  });

  it('renders the light scheme only when explicitly asked', () => {
    const { getByTestId } = render(
      <ThemeProvider scheme="light">
        <Probe />
      </ThemeProvider>,
    );
    expect((getByTestId('probe').props.children as string).startsWith('light:')).toBe(true);
  });

  it('reaches a valid brand override in the resolved colours', () => {
    const { getByTestId } = render(
      <ThemeProvider brandPrimaryColor="#059669">
        <Probe />
      </ThemeProvider>,
    );
    const [, brandDefault] = (getByTestId('probe').props.children as string).split(':');
    expect(brandDefault).not.toBe('#FFA586');
  });

  it('falls back to the default ramp on an invalid brand colour, with no crash', () => {
    const { getByTestId } = render(
      <ThemeProvider brandPrimaryColor="not-a-colour">
        <Probe />
      </ThemeProvider>,
    );
    expect(getByTestId('probe').props.children).toBe('dark:#FFA586');
  });
});
