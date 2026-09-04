import { render, screen } from '@testing-library/react-native';

import { FormField } from './FormField.tsx';
import { Input } from './Input.tsx';

describe('FormField', () => {
  it('programmatically associates the label with the control it wraps', () => {
    render(
      <FormField label="Email">
        <Input value="" onChangeText={jest.fn()} />
      </FormField>,
    );
    expect(screen.getByLabelText('Email')).toBeTruthy();
  });

  it('prefers the error over the hint as the control’s accessibility hint', () => {
    render(
      <FormField label="Email" hint="We never share this" error="Enter a valid email">
        <Input value="" onChangeText={jest.fn()} />
      </FormField>,
    );
    expect(screen.getByLabelText('Email').props.accessibilityHint).toBe('Enter a valid email');
  });

  it('reserves the message slot height whether or not a message is present', () => {
    render(
      <FormField label="Email">
        <Input value="" onChangeText={jest.fn()} />
      </FormField>,
    );
    expect(screen.queryByText('Enter a valid email')).toBeNull();
  });

  it('renders the error text visibly when present', () => {
    render(
      <FormField label="Email" error="Enter a valid email">
        <Input value="" onChangeText={jest.fn()} />
      </FormField>,
    );
    expect(screen.getByText('Enter a valid email')).toBeTruthy();
  });
});
