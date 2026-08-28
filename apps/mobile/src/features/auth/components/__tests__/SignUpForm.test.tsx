import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { SignUpForm } from '../SignUpForm.tsx';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

const mockSignUp = jest.fn();
jest.mock('../../hooks/useSignUp.ts', () => ({
  useSignUp: () => ({ signUp: mockSignUp, isSubmitting: false }),
}));

function fillValidForm() {
  fireEvent.changeText(screen.getByPlaceholderText('Full name'), 'Priya Shah');
  fireEvent.changeText(screen.getByPlaceholderText('Email'), 'priya@example.com');
  fireEvent.changeText(screen.getByPlaceholderText('Date of birth — DD / MM / YYYY'), '05/09/1998');
  fireEvent.changeText(screen.getByPlaceholderText('Password'), 'hunter2222');
}

describe('SignUpForm', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockSignUp.mockClear();
  });

  it('has no role picker — sign-up is coach-only', () => {
    render(<SignUpForm />);
    expect(screen.getByText('Coach')).toBeTruthy();
    expect(screen.queryByText(/i'?m a client/i)).toBeNull();
  });

  it('rejects a malformed date of birth before calling signUp', async () => {
    render(<SignUpForm />);
    fillValidForm();
    fireEvent.changeText(
      screen.getByPlaceholderText('Date of birth — DD / MM / YYYY'),
      '1998-09-05',
    );
    fireEvent.press(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(screen.getByText(/Use DD\/MM\/YYYY/)).toBeTruthy());
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('calls signUp with the entered values and navigates home on success', async () => {
    mockSignUp.mockResolvedValue({ ok: true });
    render(<SignUpForm />);
    fillValidForm();
    fireEvent.press(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() =>
      expect(mockSignUp).toHaveBeenCalledWith({
        name: 'Priya Shah',
        email: 'priya@example.com',
        dateOfBirth: '05/09/1998',
        password: 'hunter2222',
      }),
    );
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  });

  it('surfaces a non-revealing message on a duplicate-email conflict', async () => {
    const message =
      "We couldn't create your account with these details. Check your email, or sign in if you already have one.";
    mockSignUp.mockResolvedValue({ ok: false, error: { formMessage: message } });
    render(<SignUpForm />);
    fillValidForm();
    fireEvent.press(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
