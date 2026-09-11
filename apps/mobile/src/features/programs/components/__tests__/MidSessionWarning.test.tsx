import { render, screen, fireEvent } from '@testing-library/react-native';

import { MidSessionWarning } from '../MidSessionWarning.tsx';

// `session-runtime/09` step 5 — the half the task calls the dangerous one.
// A coach who believes they just fixed a client's working weight, and did
// not, makes a worse decision than one who knows.

function renderWarning(names: string[]) {
  const onDismiss = jest.fn();
  render(<MidSessionWarning names={names} onDismiss={onDismiss} />);
  return { onDismiss };
}

describe('MidSessionWarning', () => {
  it('names the client and says when the change lands', () => {
    renderWarning(['Priya Nair']);

    expect(
      screen.getByText(
        'Priya is training this session right now. Your changes will apply from their next session.',
      ),
    ).toBeTruthy();
  });

  it('announces itself — a coach has just pressed Save and is looking away', () => {
    renderWarning(['Priya Nair']);

    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('counts past two rather than listing', () => {
    renderWarning(['Priya Nair', 'Arjun Kapoor', 'Meera Rao']);

    expect(
      screen.getByText(/Priya and 2 others are training this session right now\./),
    ).toBeTruthy();
  });

  it('renders nothing when nobody is inside the day', () => {
    renderWarning([]);

    expect(screen.queryByTestId('mid-session-warning')).toBeNull();
  });

  it('dismisses, and offers no other action — the save already landed', () => {
    const { onDismiss } = renderWarning(['Priya Nair']);

    // Exactly one control: no retry, no undo, no "are you sure". This is a
    // sequencing rule, not a locking one, so there is nothing to confirm.
    const dismiss = screen.getByLabelText('Dismiss');
    fireEvent.press(dismiss);

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('does not truncate the sentence that says when the change applies', () => {
    // `numberOfLines` on this line would leave a coach with exactly the
    // wrong half — the name and no consequence.
    renderWarning(['Priya Nair']);

    const line = screen.getByRole('alert');
    expect(line.props.numberOfLines).toBeUndefined();
  });
});
