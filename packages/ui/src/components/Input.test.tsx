import { fireEvent, render, screen } from '@testing-library/react-native';

import { colors } from '../theme/tokens.ts';

import { Input } from './Input.tsx';

describe('Input', () => {
  it('calls onChangeText as the user types', () => {
    const onChangeText = jest.fn();
    render(<Input value="" onChangeText={onChangeText} testID="input" />);
    fireEvent.changeText(screen.getByTestId('input'), 'hello');
    expect(onChangeText).toHaveBeenCalledWith('hello');
  });

  it('disabled blocks editing and announces disabled', () => {
    render(<Input value="locked" onChangeText={jest.fn()} state="disabled" testID="input" />);
    const field = screen.getByTestId('input');
    expect(field.props.editable).toBe(false);
    expect(field.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('the error state borders the field in `border.strong`, never a red fill', () => {
    render(<Input value="" onChangeText={jest.fn()} state="error" testID="input" />);
    const field = screen.getByTestId('input');
    const flatStyle = Array.isArray(field.props.style)
      ? Object.assign({}, ...field.props.style)
      : field.props.style;
    expect(flatStyle.borderColor).toBe(colors.border.strong);
    expect(flatStyle.backgroundColor).not.toBe(colors.urgent);
  });

  it('shows a clear affordance once there is a value, and it resets the value', () => {
    const onChangeText = jest.fn();
    render(<Input value="squat" onChangeText={onChangeText} />);
    fireEvent.press(screen.getByLabelText('Clear'));
    expect(onChangeText).toHaveBeenCalledWith('');
  });

  it('renders no clear affordance when the value is empty', () => {
    render(<Input value="" onChangeText={jest.fn()} />);
    expect(screen.queryByLabelText('Clear')).toBeNull();
  });
});
