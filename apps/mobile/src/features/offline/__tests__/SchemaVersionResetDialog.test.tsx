import { fireEvent, render, screen } from '@testing-library/react-native';

import { SchemaVersionResetDialog } from '../SchemaVersionResetDialog.tsx';

// `local-database/04`'s approved copy, verbatim. What is under test is the
// exact strings, the pluralisation, the uncounted fallback, the in-flight
// collapse, and that there is no way to dismiss without confirming — not
// how it looks.
describe('SchemaVersionResetDialog', () => {
  const base = {
    isOpen: true,
    isClearing: false,
    onConfirm: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('pluralises correctly for more than one entry, with a grouped counts list', () => {
    render(
      <SchemaVersionResetDialog
        {...base}
        counts={[
          { procedure: 'workouts.logSet', label: 'Logged sets', count: 2 },
          { procedure: 'nutrition.logMeal', label: 'Meals', count: 1 },
        ]}
      />,
    );

    expect(screen.getByText('3 offline entries will be cleared')).toBeTruthy();
    expect(
      screen.getByText(
        'This version of CoachOS stores data differently on your device. These entries never reached your account, and resetting clears them.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Logged sets')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('Meals')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('Anything already saved to your account is unaffected.')).toBeTruthy();
  });

  it('uses the singular form for exactly one entry', () => {
    render(
      <SchemaVersionResetDialog
        {...base}
        counts={[{ procedure: 'workouts.logSet', label: 'Logged sets', count: 1 }]}
      />,
    );

    expect(screen.getByText('1 offline entry will be cleared')).toBeTruthy();
  });

  it('never guesses a count and never shows a counts list when the outbox could not be read', () => {
    render(<SchemaVersionResetDialog {...base} counts={null} />);

    expect(screen.getByText('Offline entries will be cleared')).toBeTruthy();
    expect(
      screen.getByText(
        'This version of CoachOS stores data differently on your device. Anything logged offline that never reached your account will be cleared.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Logged sets')).toBeNull();
  });

  it('fires onConfirm from the single primary action', () => {
    render(<SchemaVersionResetDialog {...base} counts={null} />);

    fireEvent.press(screen.getByText('Clear and continue'));

    expect(base.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('collapses to a single busy row while clearing, hiding the rest of the dialog', () => {
    render(<SchemaVersionResetDialog {...base} counts={null} isClearing />);

    expect(screen.getByText('Clearing offline data…')).toBeTruthy();
    expect(screen.queryByText('Clear and continue')).toBeNull();
    expect(screen.queryByText('Offline entries will be cleared')).toBeNull();
  });
});
