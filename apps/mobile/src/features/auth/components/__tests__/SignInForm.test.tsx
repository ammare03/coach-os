import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { SignInForm } from '../SignInForm.tsx';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  // `router-skeleton/02` made the "Forgot?" affordance a real `Link`;
  // stood in with a plain `Text` so it still renders under the test
  // renderer without a router mounted.
  Link: jest.requireActual('react-native').Text,
}));

const mockSignIn = jest.fn();
jest.mock('../../hooks/useSignIn.ts', () => ({
  useSignIn: () => ({ signIn: mockSignIn, isSubmitting: false }),
}));

describe('SignInForm', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockSignIn.mockClear();
  });

  // Slower CI runners can take longer than the 5s Jest default to settle
  // the re-render after zodResolver validates the empty form — bumped, not
  // the other two tests in this file, which don't wait on a validation pass.
  it('shows a validation error and never calls signIn when the form is empty', async () => {
    render(<SignInForm />);

    fireEvent.press(screen.getByText('Sign in'));

    await waitFor(() => expect(screen.getByText(/invalid/i)).toBeTruthy(), { timeout: 10_000 });
    expect(mockSignIn).not.toHaveBeenCalled();
  }, 15_000);

  it('calls signIn with the entered values and navigates home on success', async () => {
    mockSignIn.mockResolvedValue({ ok: true });
    render(<SignInForm />);

    fireEvent.changeText(screen.getByPlaceholderText('Email'), 'coach@example.com');
    fireEvent.changeText(screen.getByPlaceholderText('Password'), 'hunter22');
    fireEvent.press(screen.getByText('Sign in'));

    await waitFor(() =>
      expect(mockSignIn).toHaveBeenCalledWith({ email: 'coach@example.com', password: 'hunter22' }),
    );
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  });

  it('surfaces the mapped form error and never navigates on failure', async () => {
    mockSignIn.mockResolvedValue({
      ok: false,
      error: { formMessage: 'Incorrect email or password.' },
    });
    render(<SignInForm />);

    fireEvent.changeText(screen.getByPlaceholderText('Email'), 'coach@example.com');
    fireEvent.changeText(screen.getByPlaceholderText('Password'), 'wrong-password');
    fireEvent.press(screen.getByText('Sign in'));

    await waitFor(() => expect(screen.getByText('Incorrect email or password.')).toBeTruthy());
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
