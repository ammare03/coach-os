import { fireEvent, render, screen } from '@testing-library/react-native';

import { SyncFailureSheet } from '../components/SyncFailureSheet.tsx';

// The approved design's frame C. Under test: the copy, that each entry is
// named in the client's language rather than by its tRPC path, that the
// only action is a retry, and that nothing offers to throw an entry away.
describe('SyncFailureSheet', () => {
  const summary = {
    totalCount: 3,
    groups: [
      {
        procedure: 'nutrition.logMeal',
        label: 'Meals',
        count: 1,
        lastQueuedAt: new Date(2026, 8, 8, 13, 15).getTime(),
      },
      {
        procedure: 'workouts.logSet',
        label: 'Logged sets',
        count: 2,
        lastQueuedAt: new Date(2026, 8, 8, 18, 42).getTime(),
      },
    ],
  };

  const base = {
    isOpen: true,
    onDismiss: jest.fn(),
    onRetry: jest.fn(),
    isRetrying: false,
    nowMs: new Date(2026, 8, 8, 20, 0).getTime(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('reassures that nothing was lost, without apologising or blaming', () => {
    render(<SyncFailureSheet {...base} summary={summary} />);

    expect(screen.getByText('3 items couldn’t be saved')).toBeTruthy();
    expect(
      screen.getByText(
        'These are still on this device. Nothing is lost — they just haven’t reached your account.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('They’ll stay on this device until they save.')).toBeTruthy();
  });

  it('names each entry in the client language, never by its procedure path', () => {
    render(<SyncFailureSheet {...base} summary={summary} />);

    expect(screen.getByText('Logged sets')).toBeTruthy();
    expect(screen.getByText('Meals')).toBeTruthy();
    expect(screen.queryByText(/workouts\.logSet|nutrition\.logMeal/)).toBeNull();
  });

  it('says when each group was queued, on the device local day', () => {
    render(<SyncFailureSheet {...base} summary={summary} />);

    expect(screen.getAllByText(/^Today, /)).toHaveLength(2);
  });

  it('offers exactly one action, and it is the retry', () => {
    render(<SyncFailureSheet {...base} summary={summary} />);

    fireEvent.press(screen.getByText('Try again'));

    expect(base.onRetry).toHaveBeenCalledTimes(1);
    // DB§14.4 forbids dropping an entry, so there is no delete, no
    // dismiss-forever, and no bin — offering one would be the same data
    // loss with consent attached.
    expect(screen.queryByText(/delete|discard|remove|clear/i)).toBeNull();
  });

  it('renders nothing while closed', () => {
    render(<SyncFailureSheet {...base} isOpen={false} summary={summary} />);

    expect(screen.queryByText('Try again')).toBeNull();
  });
});
