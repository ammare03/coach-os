import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { SyncFailureBanner } from '../components/SyncFailureBanner.tsx';

// The approved design (frame B) and `ERRORS.md` ER§1.4's
// `SYNC_PERMANENTLY_FAILED` copy, verbatim. What is under test is the exact
// strings, the one-target-one-label accessibility contract, and that the
// announcement fires at the transition rather than on every render — not
// how it looks.
describe('SyncFailureBanner', () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

  beforeEach(() => jest.clearAllMocks());

  it('renders nothing when nothing is stuck', () => {
    render(<SyncFailureBanner count={0} onPress={jest.fn()} />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('states the consequence and the next step, and never blames', () => {
    render(<SyncFailureBanner count={2} onPress={jest.fn()} />);

    expect(screen.getByText('2 items couldn’t be saved')).toBeTruthy();
    expect(screen.getByText('Tap to see what’s stuck.')).toBeTruthy();
    // COPY §CO4.3 — the consequence, not the cause, and no apology.
    expect(screen.queryByText(/failed|wrong|sorry|error/i)).toBeNull();
  });

  it('pluralises for a single stuck entry', () => {
    render(<SyncFailureBanner count={1} onPress={jest.fn()} />);

    expect(screen.getByText('1 item couldn’t be saved')).toBeTruthy();
  });

  it('is one button carrying both the count and the action in its label', () => {
    render(<SyncFailureBanner count={3} onPress={jest.fn()} />);

    // One target, not a row of fragments: a screen reader user hears the
    // whole thing once and knows what tapping does.
    const button = screen.getByRole('button');
    expect(button.props.accessibilityLabel).toBe(
      '3 items couldn’t be saved. Tap to see what’s stuck.',
    );
  });

  it('opens the review surface when tapped', () => {
    const onPress = jest.fn();
    render(<SyncFailureBanner count={2} onPress={onPress} />);

    fireEvent.press(screen.getByRole('button'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('announces once when the failure appears, and never re-announces', () => {
    const { rerender } = render(<SyncFailureBanner count={0} onPress={jest.fn()} />);
    expect(announce).not.toHaveBeenCalled();

    rerender(<SyncFailureBanner count={2} onPress={jest.fn()} />);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('2 items couldn’t be saved. Tap to see what’s stuck.');

    // A flush that fails another entry must not interrupt whatever the
    // person is doing a second time — this is why it is an announcement and
    // not a live region.
    rerender(<SyncFailureBanner count={3} onPress={jest.fn()} />);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('announces again only after the banner has been away', () => {
    const { rerender } = render(<SyncFailureBanner count={2} onPress={jest.fn()} />);
    expect(announce).toHaveBeenCalledTimes(1);

    rerender(<SyncFailureBanner count={0} onPress={jest.fn()} />);
    rerender(<SyncFailureBanner count={1} onPress={jest.fn()} />);

    expect(announce).toHaveBeenCalledTimes(2);
  });
});
