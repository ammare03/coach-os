import { render, screen } from '@testing-library/react-native';

import type { ClientInjury } from '../../api.ts';
import { InjuriesBanner, describeInjury } from '../InjuriesBanner.tsx';

// The one acceptance criterion this component exists for
// (`client-detail/01`, and the phase README repeats it): the banner renders
// **if and only if** `client_profiles.injuries` is non-empty. Both halves
// are asserted, because the half that gets written by accident is the
// second one — an empty-state card here is the natural thing to add and is
// specifically ruled out.

function injury(overrides: Partial<ClientInjury> = {}): ClientInjury {
  return {
    area: 'left knee',
    notes: 'Avoid deep unracked squats.',
    since: '2025-11',
    severity: 'moderate',
    ...overrides,
  };
}

describe('InjuriesBanner', () => {
  it('renders nothing at all when there are no injuries', () => {
    render(<InjuriesBanner injuries={[]} />);

    // Not "renders an empty state", not "renders a collapsed card" — the
    // component contributes no node, so it takes up no height and shifts
    // nothing below it.
    expect(screen.queryByTestId('injuries-banner')).toBeNull();
    expect(screen.queryByText(/injuries/i)).toBeNull();
  });

  it('renders every recorded injury when there is at least one', () => {
    render(<InjuriesBanner injuries={[injury(), injury({ area: 'right shoulder' })]} />);

    expect(screen.getByTestId('injuries-banner')).toBeTruthy();
    expect(screen.getByText('left knee · moderate · since 2025-11')).toBeTruthy();
    expect(screen.getByText('right shoulder · moderate · since 2025-11')).toBeTruthy();
  });

  it('reads as one item, with every injury in the sentence', () => {
    render(<InjuriesBanner injuries={[injury()]} />);

    // A screen reader hears one grouped item rather than four fragments
    // (`accessibility` §2), and the notes are IN it — they are the part a
    // coach must not miss.
    expect(
      screen.getByLabelText(
        'Injuries on file. left knee, moderate, since 2025-11. Avoid deep unracked squats.',
      ),
    ).toBeTruthy();
  });

  it('omits a field the client never recorded rather than saying "unknown"', () => {
    render(<InjuriesBanner injuries={[injury({ notes: null, since: null, severity: null })]} />);

    expect(screen.getByText('left knee')).toBeTruthy();
  });
});

describe('describeInjury', () => {
  it('joins only the fields that are present', () => {
    expect(describeInjury(injury({ severity: null }))).toBe('left knee · since 2025-11');
    expect(describeInjury(injury({ since: null }))).toBe('left knee · moderate');
  });

  it('relays `since` verbatim rather than parsing it as a date', () => {
    // The column is free text (DB§5.1 has no `CHECK`), and a date parser
    // over it would render a confident wrong month.
    expect(describeInjury(injury({ since: 'school', severity: null }))).toBe(
      'left knee · since school',
    );
  });
});
