import { fireEvent, render, screen } from '@testing-library/react-native';

import { ConfirmModal } from './ConfirmModal.tsx';

// The typed match is the entire point of this component, so that is what
// gets tested — not how it looks. Every assertion below is a way someone
// could accidentally make deletion a one-tap action.
describe('ConfirmModal', () => {
  const base = {
    isOpen: true,
    onCancel: jest.fn(),
    onConfirm: jest.fn(),
    title: 'Delete your account',
    body: 'This removes your workouts, photos, and messages after a 7-day grace period.',
    confirmationText: 'DELETE',
    actionLabel: 'Delete account',
  };

  beforeEach(() => jest.clearAllMocks());

  it('keeps the action inert until the typed text matches', () => {
    render(<ConfirmModal {...base} />);

    fireEvent.press(screen.getByText('Delete account'));
    expect(base.onConfirm).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByPlaceholderText('DELETE'), 'DELETE');
    fireEvent.press(screen.getByText('Delete account'));
    expect(base.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('matches case-sensitively', () => {
    render(<ConfirmModal {...base} />);

    fireEvent.changeText(screen.getByPlaceholderText('DELETE'), 'delete');
    fireEvent.press(screen.getByText('Delete account'));
    expect(base.onConfirm).not.toHaveBeenCalled();
  });

  it('rejects a partial match and a match with surrounding whitespace', () => {
    render(<ConfirmModal {...base} />);
    const input = screen.getByPlaceholderText('DELETE');

    for (const attempt of ['DELET', 'DELETE ', ' DELETE', 'DELETE!']) {
      fireEvent.changeText(input, attempt);
      fireEvent.press(screen.getByText('Delete account'));
    }
    expect(base.onConfirm).not.toHaveBeenCalled();
  });

  it('clears the typed text when it closes, so reopening reconfirms', () => {
    const { rerender } = render(<ConfirmModal {...base} />);
    fireEvent.changeText(screen.getByPlaceholderText('DELETE'), 'DELETE');

    rerender(<ConfirmModal {...base} isOpen={false} />);
    rerender(<ConfirmModal {...base} isOpen />);

    fireEvent.press(screen.getByText('Delete account'));
    expect(base.onConfirm).not.toHaveBeenCalled();
  });

  it('cancels without confirming', () => {
    render(<ConfirmModal {...base} />);
    fireEvent.press(screen.getByText('Cancel'));

    expect(base.onCancel).toHaveBeenCalledTimes(1);
    expect(base.onConfirm).not.toHaveBeenCalled();
  });
});
