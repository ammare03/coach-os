import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ClaimSheet, type ClaimSheetStatus } from '../ClaimSheet.tsx';

// `session-runtime/08`'s only rendered surface. What is worth asserting is
// not the layout — it is the three promises the copy and the controls make:
// the way out is always one tap, the transfer beat cannot be half-cancelled,
// and a failed catch-up still leads into the logger.

// `SheetFooter` composes the home-indicator inset, which the native module
// does not report under Jest.
const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function renderSheet(status: ClaimSheetStatus) {
  const onContinueHere = jest.fn();
  const onCancel = jest.fn();

  const wrap = (children: ReactNode) => (
    <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>{children}</SafeAreaProvider>
  );

  render(
    wrap(<ClaimSheet isOpen status={status} onContinueHere={onContinueHere} onCancel={onCancel} />),
  );

  return { onContinueHere, onCancel };
}

describe('the offer', () => {
  it('says which situation this is without naming the other device', () => {
    // A device name would be a stable identifier for hardware the client may
    // no longer own, and the server deliberately sends none.
    renderSheet('offered');

    expect(screen.getByText(/another device/i)).toBeTruthy();
    expect(screen.queryByText(/iphone|ipad|android|minutes ago/i)).toBeNull();
  });

  it('puts the client one tap from a loggable session', () => {
    // The acceptance criterion that outranks the rest.
    const { onContinueHere } = renderSheet('offered');

    fireEvent.press(screen.getByText('Continue here'));

    expect(onContinueHere).toHaveBeenCalledTimes(1);
  });

  it('offers a way out that leaves the session where it is', () => {
    const { onCancel } = renderSheet('offered');

    fireEvent.press(screen.getByLabelText('Close'));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('the transfer beat', () => {
  it('drops the close affordance, because there is nothing left to cancel', () => {
    // The claim has already moved server-side; only the catch-up remains. A
    // control that appears to cancel would cancel nothing the client thinks.
    renderSheet('transferring');

    expect(screen.queryByLabelText('Close')).toBeNull();
  });

  it('says what it is doing without counting what it cannot know', () => {
    renderSheet('transferring');

    expect(screen.getByText('Loading what the other device logged.')).toBeTruthy();
  });

  it('does not fire the action again while it is already running', () => {
    const { onContinueHere } = renderSheet('transferring');

    fireEvent.press(screen.getByText('Catching up'));

    expect(onContinueHere).not.toHaveBeenCalled();
  });

  it('names the beat rather than repeating the offer the client just accepted', () => {
    // `Button` hides the label behind its spinner, so this is invisible — but
    // it stays in the tree and is what VoiceOver reads off a button that has
    // just gone busy. The design's frame B names it.
    renderSheet('transferring');

    expect(screen.getByText('Catching up')).toBeTruthy();
    expect(screen.queryByText('Continue here')).toBeNull();
  });
});

describe('a catch-up that failed', () => {
  it('still leads into the logger rather than into a retry loop', () => {
    // Someone is holding a barbell. "Start here anyway" is the whole point.
    const { onContinueHere } = renderSheet('catchup-failed');

    fireEvent.press(screen.getByText('Start here anyway'));

    expect(onContinueHere).toHaveBeenCalledTimes(1);
  });

  it('states the mechanism instead of promising an outcome', () => {
    renderSheet('catchup-failed');

    expect(screen.getByText(/join up once they're back online/i)).toBeTruthy();
  });

  it('brings the way out back, because there is a decision left', () => {
    const { onCancel } = renderSheet('catchup-failed');

    fireEvent.press(screen.getByLabelText('Close'));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('the copy', () => {
  it.each<ClaimSheetStatus>(['offered', 'transferring', 'catchup-failed'])(
    'never shames or exclaims in the %s state',
    (status) => {
      // `product-copy` §3 and §6. A client whose two devices disagree has
      // done nothing wrong, and errors are not cute.
      renderSheet(status);

      expect(screen.queryByText(/!|just |simply |oops/i)).toBeNull();
    },
  );
});
