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

  it('speaks its visible label when no override is given', () => {
    // The default every caller that predates `accessibilityLabel` relies on.
    render(<Chip label="Legs" onPress={jest.fn()} />);
    expect(screen.getByLabelText('Legs')).toBeTruthy();
  });

  it('speaks the override instead, without changing what is printed', () => {
    render(<Chip label="Warm-up" accessibilityLabel="Warm-up set" onPress={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Warm-up set' })).toBeTruthy();
    expect(screen.queryByLabelText('Warm-up')).toBeNull();
    // The pill still reads `Warm-up`: the override is the spoken name, not
    // a second copy string (`accessibility` §2).
    expect(screen.getByText('Warm-up')).toBeTruthy();
  });

  it('applies the override on the tag branch too, where there is no onPress', () => {
    render(<Chip label="Warm-up" accessibilityLabel="Warm-up set" />);

    expect(screen.getByLabelText('Warm-up set')).toBeTruthy();
  });

  it('names the remove affordance after the spoken label, not the printed one', () => {
    render(
      <Chip label="Legs" accessibilityLabel="Legs day" onPress={jest.fn()} onRemove={jest.fn()} />,
    );

    expect(screen.getByLabelText('Remove Legs day')).toBeTruthy();
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
