import { render, screen } from '@testing-library/react-native';

import { Text } from './Text.tsx';

describe('Text', () => {
  it('defaults to body size', () => {
    render(<Text testID="t">Hello</Text>);
    const style = screen.getByTestId('t').props.className as string;
    expect(style).toContain('text-body');
    expect(style).toContain('font-sans');
  });

  // `DESIGN.md` §1.2 pins a face AND a weight to every named size. Space
  // Grotesk carries every numeral and heading — including headings, which
  // are words — and Instrument Sans carries everything else. There is no
  // `weight` prop to get wrong.
  it('maps every size to its pinned face — never a caller-chosen weight', () => {
    const cases: [string, string][] = [
      ['display', 'font-display-bold'],
      ['numeral-xl', 'font-display-bold'],
      ['stat', 'font-display-semibold'],
      ['h1-client', 'font-display-bold'],
      ['h1', 'font-display-bold'],
      ['h2', 'font-display-bold'],
      ['numeral', 'font-display-semibold'],
      ['title', 'font-sans-semibold'],
      ['body-lg', 'font-sans'],
      ['body-sm', 'font-sans'],
      ['label', 'font-sans-medium'],
      ['caption', 'font-sans'],
      ['micro', 'font-sans'],
      ['eyebrow', 'font-sans-medium'],
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

  it('maps every tone in the warm text ramp to its fg token', () => {
    const cases: [string, string][] = [
      ['bright', 'text-fg-bright'],
      ['default', 'text-fg'],
      ['glass', 'text-fg-glass'],
      ['warm', 'text-fg-warm'],
      ['warm-muted', 'text-fg-warm-muted'],
      ['muted', 'text-fg-muted'],
      ['subtle', 'text-fg-subtle'],
      ['faint', 'text-fg-faint'],
      ['onBrand', 'text-fg-onBrand'],
      ['urgent', 'text-urgent-text'],
    ];
    for (const [tone, expected] of cases) {
      render(
        <Text testID={`tone-${tone}`} tone={tone as never}>
          x
        </Text>,
      );
      expect(screen.getByTestId(`tone-${tone}`).props.className).toContain(expected);
    }
  });
});
