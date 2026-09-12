import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  DashboardCounters,
  type DashboardCounterKey,
  type DashboardCounterValues,
} from '../DashboardCounters.tsx';

const VALUES: DashboardCounterValues = { needsReview: 7, offPlan: 3, checkinsDue: 5 };

function renderCounters(
  options: { values?: DashboardCounterValues; selected?: DashboardCounterKey | null } = {},
) {
  const onSelect = jest.fn<void, [DashboardCounterKey]>();
  render(
    <DashboardCounters
      values={options.values ?? VALUES}
      selected={options.selected ?? null}
      onSelect={onSelect}
    />,
  );
  return { onSelect };
}

describe('DashboardCounters', () => {
  it('renders all three counters with their value', () => {
    renderCounters();

    // Queried by label, not testID — this is the string a screen reader
    // announces, so the assertion doubles as the accessibility check
    // (`testing` §6).
    expect(screen.getByLabelText('Needs review, 7')).toBeTruthy();
    expect(screen.getByLabelText('Off plan, 3')).toBeTruthy();
    expect(screen.getByLabelText('Check-ins due, 5')).toBeTruthy();
  });

  it('reports each counter individually when tapped', () => {
    const { onSelect } = renderCounters();

    fireEvent.press(screen.getByLabelText('Needs review, 7'));
    fireEvent.press(screen.getByLabelText('Off plan, 3'));
    fireEvent.press(screen.getByLabelText('Check-ins due, 5'));

    expect(onSelect.mock.calls).toEqual([['needsReview'], ['offPlan'], ['checkinsDue']]);
  });

  it('still reports the selected counter when it is tapped again', () => {
    const { onSelect } = renderCounters({ selected: 'offPlan' });

    fireEvent.press(screen.getByLabelText('Off plan, 3'));

    // Clearing is the caller's decision, not this component's — it reports
    // the tap and stays stateless, which is what lets
    // `coach-dashboard/02` own the filter without rewriting this.
    expect(onSelect).toHaveBeenCalledWith('offPlan');
  });

  it('keeps all three counters visible while one is selected', () => {
    renderCounters({ selected: 'offPlan' });

    expect(screen.getByLabelText('Needs review, 7')).toBeTruthy();
    expect(screen.getByLabelText('Off plan, 3')).toBeTruthy();
    expect(screen.getByLabelText('Check-ins due, 5')).toBeTruthy();
  });

  it('renders a zero counter rather than hiding it', () => {
    renderCounters({ values: { needsReview: 0, offPlan: 0, checkinsDue: 0 } });

    // A coach with nothing to review sees three zeroes, not an absence —
    // and the zero renders muted, never the colour §8 reserves for a
    // failing client (`ui-conventions` §2).
    expect(screen.getByLabelText('Needs review, 0')).toBeTruthy();
    expect(screen.getByLabelText('Off plan, 0')).toBeTruthy();
    expect(screen.getByLabelText('Check-ins due, 0')).toBeTruthy();
  });

  it('borrows the adherence vocabulary rather than inventing a second one', () => {
    renderCounters();

    // "Off plan" is `ADHERENCE_STATE_LABEL['off-track']`. If that label is
    // reworded this counter moves with it — a card saying "off track"
    // beside dots saying "off plan" is the drift the shared constant exists
    // to prevent.
    expect(screen.queryByLabelText('Off track, 3')).toBeNull();
    expect(screen.getByLabelText('Off plan, 3')).toBeTruthy();
  });
});
