import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ClientListFilters } from '../../hooks/useClientListFilters.ts';
import { ClientListControls } from '../ClientListControls.tsx';

// The font scale the component branches on. Mocked at the module React
// Native's own `useWindowDimensions` re-exports, which is the only seam that
// does not require a device (`accessibility` §3 — 200% text is a test, not a
// hope).
let mockFontScale = 1;

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }),
}));

function filters(overrides: Partial<ClientListFilters> = {}): ClientListFilters {
  return {
    clients: [],
    totalCount: 26,
    sort: 'attention',
    query: '',
    draftQuery: '',
    statuses: [],
    goals: [],
    counter: null,
    setQuery: jest.fn(),
    setSort: jest.fn(),
    toggleStatus: jest.fn(),
    toggleGoal: jest.fn(),
    selectCounter: jest.fn(),
    clearFilters: jest.fn(),
    clearAll: jest.fn(),
    activeFilterCount: 0,
    isNarrowed: false,
    ...overrides,
  };
}

/** Selection is announced, not merely drawn — read from the node the label is on. */
function isSelected(label: string): boolean {
  const state: unknown = screen.getByLabelText(label).props.accessibilityState;
  return typeof state === 'object' && state !== null && 'selected' in state
    ? state.selected === true
    : false;
}

beforeEach(() => {
  mockFontScale = 1;
});

describe('ClientListControls', () => {
  it('offers a labelled search field, the three sorts, and a filter toggle', () => {
    render(<ClientListControls filters={filters()} />);

    expect(screen.getByLabelText('Search clients')).toBeTruthy();
    expect(screen.getByLabelText('Attention, tab 1 of 3')).toBeTruthy();
    expect(screen.getByLabelText('Name, tab 2 of 3')).toBeTruthy();
    expect(screen.getByLabelText('Last active, tab 3 of 3')).toBeTruthy();
    expect(screen.getByLabelText('Show filters')).toBeTruthy();
  });

  it('reports each keystroke immediately — the debounce is on the list, not the field', () => {
    const state = filters();
    render(<ClientListControls filters={state} />);

    fireEvent.changeText(screen.getByLabelText('Search clients'), 'sha');

    expect(state.setQuery).toHaveBeenCalledWith('sha');
  });

  it('changes the sort', () => {
    const state = filters();
    render(<ClientListControls filters={state} />);

    fireEvent.press(screen.getByLabelText('Name, tab 2 of 3'));

    expect(state.setSort).toHaveBeenCalledWith('name');
  });

  it('keeps the facet chips out of the way until the coach asks for them', () => {
    const state = filters();
    render(<ClientListControls filters={state} />);

    expect(screen.queryByLabelText('Invited status')).toBeNull();

    fireEvent.press(screen.getByLabelText('Show filters'));

    expect(screen.getByLabelText('Active status')).toBeTruthy();
    expect(screen.getByLabelText('Invited status')).toBeTruthy();
    expect(screen.getByLabelText('Fat loss goal')).toBeTruthy();
    expect(screen.getByLabelText('Muscle gain goal')).toBeTruthy();
    expect(screen.getByLabelText('Hide filters')).toBeTruthy();
  });

  it('toggles a status and a goal from the open panel', () => {
    const state = filters();
    render(<ClientListControls filters={state} />);
    fireEvent.press(screen.getByLabelText('Show filters'));

    fireEvent.press(screen.getByLabelText('Invited status'));
    fireEvent.press(screen.getByLabelText('Health goal'));

    expect(state.toggleStatus).toHaveBeenCalledWith('invited');
    expect(state.toggleGoal).toHaveBeenCalledWith('health');
  });

  it('announces an active chip as selected, not merely as a colour', () => {
    const state = filters({ statuses: ['active'], activeFilterCount: 1, isNarrowed: true });
    render(<ClientListControls filters={state} />);
    fireEvent.press(screen.getByLabelText('Show filters, 1 active'));

    expect(isSelected('Active status')).toBe(true);
    expect(isSelected('Invited status')).toBe(false);
  });

  // The rule the collapse depends on: a filter is never in force while
  // invisible. Folding the panel leaves every live filter on screen as its
  // own removable chip.
  it('keeps every active filter visible and removable while the panel is closed', () => {
    const state = filters({
      statuses: ['invited'],
      goals: ['fat_loss'],
      activeFilterCount: 2,
      isNarrowed: true,
    });
    render(<ClientListControls filters={state} />);

    expect(screen.getByLabelText('Show filters, 2 active')).toBeTruthy();
    expect(screen.getByText('Filters · 2')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Remove Invited status'));
    fireEvent.press(screen.getByLabelText('Remove Fat loss goal'));

    expect(state.toggleStatus).toHaveBeenCalledWith('invited');
    expect(state.toggleGoal).toHaveBeenCalledWith('fat_loss');
  });

  it('clears the chips from inside the open panel', () => {
    const state = filters({ goals: ['other'], activeFilterCount: 1, isNarrowed: true });
    render(<ClientListControls filters={state} />);
    fireEvent.press(screen.getByLabelText('Show filters, 1 active'));

    fireEvent.press(screen.getByLabelText('Clear filters'));

    expect(state.clearFilters).toHaveBeenCalled();
  });

  it('says how much of the roster is showing, but only once something narrows it', () => {
    render(<ClientListControls filters={filters()} />);
    expect(screen.queryByTestId('client-list-count')).toBeNull();

    screen.rerender(
      <ClientListControls filters={filters({ clients: new Array<never>(3), isNarrowed: true })} />,
    );

    expect(screen.getByText('3 of 26 clients')).toBeTruthy();
  });

  it('says "1 client", not "1 clients"', () => {
    render(
      <ClientListControls
        filters={filters({ clients: new Array<never>(1), totalCount: 1, isNarrowed: true })}
      />,
    );

    expect(screen.getByText('1 of 1 client')).toBeTruthy();
  });

  // Three words will not sit in three segments a third of a phone wide at
  // 26px; the middle one truncates, and a sort option nobody can read is a
  // sort option nobody can choose.
  it('reflows the sort to wrapping chips at 200% text rather than clipping it', () => {
    mockFontScale = 2;
    const state = filters();
    render(<ClientListControls filters={state} />);

    expect(screen.queryByLabelText('Name, tab 2 of 3')).toBeNull();

    expect(isSelected('Sort by attention')).toBe(true);
    expect(isSelected('Sort by last active')).toBe(false);

    fireEvent.press(screen.getByLabelText('Sort by last active'));
    expect(state.setSort).toHaveBeenCalledWith('last-active');
  });
});
