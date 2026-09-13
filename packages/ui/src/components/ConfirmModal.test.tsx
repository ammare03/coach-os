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

// S44 — the message slot and the disabled-action path. Both exist because
// `LeaveCoachRow` had to append its failure as a fourth paragraph of `body`
// and guard offline inside `onConfirm`; every assertion here is a way that
// workaround could come back.
describe('ConfirmModal — the message slot', () => {
  const base = {
    isOpen: true,
    onCancel: jest.fn(),
    onConfirm: jest.fn(),
    title: 'Leave Arjun Mehta',
    body: 'Arjun keeps read-only access for 30 days.',
    confirmationText: 'LEAVE',
    actionLabel: 'Leave coach',
  };

  beforeEach(() => jest.clearAllMocks());

  it('renders the message under the field, not inside the body', () => {
    render(<ConfirmModal {...base} message="Something went wrong." />);

    expect(screen.getByText('Something went wrong.')).toBeTruthy();
    // The body is one Text node and stays one statement — the message is a
    // sibling of the field, never a fourth paragraph appended to it.
    expect(screen.getByText(base.body).props.children).toBe(base.body);
  });

  it('gives the message to the field as its hint, so the reason is announced', () => {
    render(<ConfirmModal {...base} message="Something went wrong." />);

    expect(screen.getByPlaceholderText('LEAVE').props.accessibilityHint).toBe(
      'Something went wrong.',
    );
  });

  it('leaves the action pressable with a message alone — retrying is one tap', () => {
    render(<ConfirmModal {...base} message="Something went wrong." />);

    fireEvent.changeText(screen.getByPlaceholderText('LEAVE'), 'LEAVE');
    fireEvent.press(screen.getByText('Leave coach'));
    expect(base.onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('ConfirmModal — the disabled-action path', () => {
  const base = {
    isOpen: true,
    onCancel: jest.fn(),
    onConfirm: jest.fn(),
    title: 'Leave Arjun Mehta',
    body: 'Arjun keeps read-only access for 30 days.',
    confirmationText: 'LEAVE',
    actionLabel: 'Leave coach',
  };

  beforeEach(() => jest.clearAllMocks());

  it('blocks the action even when the typed text matches', () => {
    render(<ConfirmModal {...base} isActionDisabled />);

    fireEvent.changeText(screen.getByPlaceholderText('LEAVE'), 'LEAVE');
    fireEvent.press(screen.getByText('Leave coach'));
    expect(base.onConfirm).not.toHaveBeenCalled();
  });

  it('is disabled for a screen reader too, not only dimmed', () => {
    render(<ConfirmModal {...base} isActionDisabled />);
    fireEvent.changeText(screen.getByPlaceholderText('LEAVE'), 'LEAVE');

    expect(
      screen.getByRole('button', { name: 'Leave coach' }).props.accessibilityState,
    ).toMatchObject({ disabled: true });
  });

  it('still lets the dialog be cancelled', () => {
    render(<ConfirmModal {...base} isActionDisabled message="Offline." />);
    fireEvent.press(screen.getByText('Cancel'));

    expect(base.onCancel).toHaveBeenCalledTimes(1);
  });
});
