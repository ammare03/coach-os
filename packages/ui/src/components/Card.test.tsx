import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Card } from './Card.tsx';

describe('Card', () => {
  it('exposes the button role and fires onPress when pressable', () => {
    const onPress = jest.fn();
    render(
      <Card onPress={onPress} accessibilityLabel="Open client" testID="card">
        <Text>Client row</Text>
      </Card>,
    );
    const button = screen.getByLabelText('Open client');
    expect(button.props.accessibilityRole).toBe('button');
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is not focusable as a control when static (no onPress)', () => {
    render(
      <Card testID="static-card">
        <Text>Static content</Text>
      </Card>,
    );
    const card = screen.getByTestId('static-card');
    expect(card.props.accessibilityRole).toBeUndefined();
    expect(card.props.accessible).toBe(false);
  });

  it('renders every elevation level without throwing', () => {
    const levels = ['canvas', 'inset', 'raised', 'tinted'] as const;
    for (const level of levels) {
      expect(() =>
        render(
          <Card elevation={level} testID={`card-${level}`}>
            <Text>Content</Text>
          </Card>,
        ),
      ).not.toThrow();
    }
  });

  it('renders at both densities without throwing', () => {
    expect(() =>
      render(
        <Card density="coach">
          <Text>Coach density</Text>
        </Card>,
      ),
    ).not.toThrow();
    expect(() =>
      render(
        <Card density="client">
          <Text>Client density</Text>
        </Card>,
      ),
    ).not.toThrow();
  });
});
