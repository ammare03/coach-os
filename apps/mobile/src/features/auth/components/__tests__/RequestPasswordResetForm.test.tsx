import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { RequestPasswordResetForm } from '../RequestPasswordResetForm.tsx';

const mockRequest = jest.fn();
jest.mock('../../hooks/useRequestPasswordReset.ts', () => ({
  useRequestPasswordReset: () => ({
    requestPasswordReset: mockRequest,
    isSubmitting: false,
  }),
}));

describe('RequestPasswordResetForm', () => {
  it('never calls the procedure when the email is not an email', async () => {
    render(<RequestPasswordResetForm onDone={jest.fn()} />);

    fireEvent.changeText(screen.getByPlaceholderText('Email'), 'not-an-email');
    fireEvent.press(screen.getByText('Send reset link'));

    await waitFor(() => expect(screen.getByText(/invalid/i)).toBeTruthy(), { timeout: 10_000 });
    expect(mockRequest).not.toHaveBeenCalled();
  }, 15_000);

  it('confirms without confirming that the account exists', async () => {
    mockRequest.mockResolvedValue({ ok: true });
    render(<RequestPasswordResetForm onDone={jest.fn()} />);

    fireEvent.changeText(screen.getByPlaceholderText('Email'), 'coach@example.com');
    fireEvent.press(screen.getByText('Send reset link'));

    await waitFor(() => expect(screen.getByText('Check your email')).toBeTruthy());
    expect(mockRequest).toHaveBeenCalledWith({ email: 'coach@example.com' });
    // The conditional is load-bearing: `auth.requestReset` answers
    // identically for an email with an account and one without, and copy
    // that said "we sent you a link" would turn this screen into the
    // enumeration oracle the procedure is careful not to be.
    expect(screen.getByText(/If there is an account for coach@example.com/)).toBeTruthy();
    expect(screen.queryByPlaceholderText('Email')).toBeNull();
  });

  it('offers a way out of the confirmation', async () => {
    mockRequest.mockResolvedValue({ ok: true });
    const onDone = jest.fn();
    render(<RequestPasswordResetForm onDone={onDone} />);

    fireEvent.changeText(screen.getByPlaceholderText('Email'), 'coach@example.com');
    fireEvent.press(screen.getByText('Send reset link'));

    await waitFor(() => expect(screen.getByText('Back to sign in')).toBeTruthy());
    fireEvent.press(screen.getByText('Back to sign in'));

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('surfaces a rate-limit failure and keeps the form on screen', async () => {
    mockRequest.mockResolvedValue({
      ok: false,
      error: { formMessage: 'Too many attempts. Try again in a few minutes.' },
    });
    render(<RequestPasswordResetForm onDone={jest.fn()} />);

    fireEvent.changeText(screen.getByPlaceholderText('Email'), 'coach@example.com');
    fireEvent.press(screen.getByText('Send reset link'));

    await waitFor(() =>
      expect(screen.getByText('Too many attempts. Try again in a few minutes.')).toBeTruthy(),
    );
    expect(screen.queryByText('Check your email')).toBeNull();
    expect(screen.getByPlaceholderText('Email')).toBeTruthy();
  });
});
