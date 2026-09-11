import { fireEvent, render, screen } from '@testing-library/react-native';
import { Download } from 'lucide-react-native';
import { StyleSheet, Text as RNText } from 'react-native';

import { LIST_ROW_MIN_HEIGHT, ListRow, listRowMinHeight } from './ListRow.tsx';

function minHeightOf(testID: string): number | undefined {
  const flattened = StyleSheet.flatten(screen.getByTestId(testID).props.style) as
    { minHeight?: number } | undefined;
  return flattened?.minHeight;
}

describe('ListRow — tap target', () => {
  it('never resolves below the 48pt floor at either density', () => {
    expect(listRowMinHeight('client')).toBeGreaterThanOrEqual(LIST_ROW_MIN_HEIGHT);
    expect(listRowMinHeight('coach')).toBeGreaterThanOrEqual(LIST_ROW_MIN_HEIGHT);
  });

  it('applies that height to the touch target itself, both densities', () => {
    render(<ListRow label="Your data" onPress={jest.fn()} density="client" testID="client-row" />);
    expect(minHeightOf('client-row')).toBe(listRowMinHeight('client'));

    render(<ListRow label="Your data" onPress={jest.fn()} density="coach" testID="coach-row" />);
    expect(minHeightOf('coach-row')).toBe(listRowMinHeight('coach'));
  });

  it('gives a static row the same floor — it is still a 48pt band in the list', () => {
    render(<ListRow label="App version" trailing={{ kind: 'none' }} testID="static" />);
    expect(minHeightOf('static')).toBeGreaterThanOrEqual(LIST_ROW_MIN_HEIGHT);
  });
});

describe('ListRow — accessibility role per variant', () => {
  it('chevron: button by default, and it fires', () => {
    const onPress = jest.fn();
    render(<ListRow label="Medical disclaimer" onPress={onPress} />);

    const row = screen.getByRole('button', { name: 'Medical disclaimer' });
    fireEvent.press(row);

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('chevron: link when the row leaves the app', () => {
    render(<ListRow label="Terms" onPress={jest.fn()} accessibilityRole="link" />);
    expect(screen.getByRole('link', { name: 'Terms' })).toBeTruthy();
  });

  it('value: reads the label and its current value as one item', () => {
    render(<ListRow label="Appearance" trailing={{ kind: 'value', value: 'Dark' }} />);
    expect(screen.getByLabelText('Appearance, Dark')).toBeTruthy();
  });

  it('switch: role switch, checked state, and the whole row toggles', () => {
    const onValueChange = jest.fn();
    render(
      <ListRow
        label="Share usage data"
        trailing={{ kind: 'switch', value: false, onValueChange }}
      />,
    );

    const row = screen.getByRole('switch', { name: 'Share usage data' });
    expect(row.props.accessibilityState).toMatchObject({ checked: false });

    fireEvent.press(row);
    expect(onValueChange).toHaveBeenCalledWith(true);
  });

  it('switch: reports checked when on', () => {
    render(
      <ListRow
        label="Sync workouts"
        trailing={{ kind: 'switch', value: true, onValueChange: jest.fn() }}
      />,
    );
    expect(
      screen.getByRole('switch', { name: 'Sync workouts' }).props.accessibilityState,
    ).toMatchObject({ checked: true });
  });

  it('none: static, so it is not a control at all', () => {
    render(<ListRow label="App version" trailing={{ kind: 'value', value: '1.0.0 (24)' }} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByLabelText('App version, 1.0.0 (24)').props.accessibilityRole).toBe('text');
  });

  it('folds a description into the row rather than leaving it a second item', () => {
    render(
      <ListRow
        label="Your data"
        description="Request a copy of everything you have logged"
        onPress={jest.fn()}
      />,
    );
    expect(
      screen.getByLabelText('Your data, Request a copy of everything you have logged'),
    ).toBeTruthy();
  });

  it('keeps the icon out of the reading order — the label already names the row', () => {
    render(<ListRow label="Your data" icon={Download} onPress={jest.fn()} />);

    // One accessible item, named by the label. An icon that announced
    // itself would make the row read as two.
    expect(screen.getByRole('button', { name: 'Your data' })).toBeTruthy();
    expect(screen.queryByLabelText(/icon/i)).toBeNull();
  });
});

describe('ListRow — disabled', () => {
  it('announces itself disabled and does not fire', () => {
    const onPress = jest.fn();
    render(
      <ListRow label="Light theme" description="Not available yet" onPress={onPress} disabled />,
    );

    const row = screen.getByLabelText('Light theme, Not available yet');
    expect(row.props.accessibilityState).toMatchObject({ disabled: true });

    fireEvent.press(row);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('does not fire a disabled switch', () => {
    const onValueChange = jest.fn();
    render(
      <ListRow
        label="Quiet hours"
        trailing={{ kind: 'switch', value: false, onValueChange }}
        disabled
      />,
    );

    fireEvent.press(screen.getByLabelText('Quiet hours'));
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe('ListRow — destructive', () => {
  it('draws no chevron: it acts, it does not navigate', () => {
    render(<ListRow label="Delete account" onPress={jest.fn()} destructive />);

    expect(screen.getByRole('button', { name: 'Delete account' })).toBeTruthy();
    // `includeHiddenElements`: the chevron is deliberately out of the
    // reading order, so the default query would report it absent either way.
    expect(screen.queryByTestId('list-row-chevron', { includeHiddenElements: true })).toBeNull();
  });

  it('a navigating row does draw one', () => {
    render(<ListRow label="Your data" onPress={jest.fn()} />);
    expect(screen.getByTestId('list-row-chevron', { includeHiddenElements: true })).toBeTruthy();
  });
});

describe('ListRow — custom trailing', () => {
  it('renders the caller-supplied slot', () => {
    render(
      <ListRow
        label="Blocked people"
        onPress={jest.fn()}
        trailing={{ kind: 'custom', render: () => <RNText>3</RNText> }}
      />,
    );
    expect(screen.getByText('3', { includeHiddenElements: true })).toBeTruthy();
  });
});
