import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ThemeProvider } from './ThemeProvider.tsx';
import { useTheme } from './useTheme.ts';

function Probe() {
  const theme = useTheme();
  return <Text testID="probe">{`${theme.scheme}:${theme.colors.brand.DEFAULT}`}</Text>;
}

describe('useTheme', () => {
  it('throws outside a ThemeProvider', () => {
    // Swallow the expected React error-boundary console noise for this one assertion.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow('useTheme() must be called within a <ThemeProvider>.');
    spy.mockRestore();
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
