import { fireEvent, render, screen } from '@testing-library/react-native';

import { Chip } from './Chip.tsx';

describe('Chip', () => {
  it('announces selected state', () => {
    render(<Chip label="Legs" selected onPress={jest.fn()} />);
    const chip = screen.getByRole('button', { name: 'Legs' });
    expect(chip.props.accessibilityState?.selected).toBe(true);
  });

  it('announces unselected state', () => {
    render(<Chip label="Legs" selected={false} onPress={jest.fn()} />);
    const chip = screen.getByRole('button', { name: 'Legs' });
    expect(chip.props.accessibilityState?.selected).toBe(false);
  });

  it('fires onPress when the chip body is pressed', () => {
    const onPress = jest.fn();
    render(<Chip label="Legs" onPress={onPress} />);
    fireEvent.press(screen.getByRole('button', { name: 'Legs' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('gives the remove affordance its own label and does not fire onPress when pressed', () => {
    const onPress = jest.fn();
    const onRemove = jest.fn();
    render(<Chip label="Legs" onPress={onPress} onRemove={onRemove} />);

    fireEvent.press(screen.getByLabelText('Remove Legs'));

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('still fires onPress from the chip body when a remove affordance is also present', () => {
    const onPress = jest.fn();
    const onRemove = jest.fn();
    render(<Chip label="Legs" onPress={onPress} onRemove={onRemove} />);

    fireEvent.press(screen.getByRole('button', { name: 'Legs' }));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onRemove).not.toHaveBeenCalled();
  });
});
