import { render, screen } from '@testing-library/react-native';

import { Text } from './Text.tsx';

describe('Text', () => {
  it('defaults to body size (16pt, the client-app floor)', () => {
    render(<Text testID="t">Hello</Text>);
    const style = screen.getByTestId('t').props.className as string;
    expect(style).toContain('text-body');
    expect(style).toContain('font-sans');
  });

  it('maps every DS§3.1 size to its pinned face — never a caller-chosen weight', () => {
    const cases: [string, string][] = [
      ['display', 'font-display-bold'],
      ['hero', 'font-display-bold'],
      ['metric', 'font-display-semibold'],
      ['metric-sm', 'font-display-semibold'],
      ['title', 'font-sans-semibold'],
      ['heading', 'font-sans-semibold'],
      ['body-sm', 'font-sans'],
      ['label', 'font-sans-medium'],
      ['caption', 'font-sans'],
    ];
    for (const [size, expectedFace] of cases) {
      render(
        <Text testID={`t-${size}`} size={size as never}>
          x
        </Text>,
      );
      const className = screen.getByTestId(`t-${size}`).props.className as string;
      expect(className).toContain(`text-${size}`);
      expect(className).toContain(expectedFace);
    }
  });

  it('maps tone to the correct fg token', () => {
    render(
      <Text testID="muted" tone="muted">
        x
      </Text>,
    );
    expect(screen.getByTestId('muted').props.className).toContain('text-fg-muted');
  });
});
