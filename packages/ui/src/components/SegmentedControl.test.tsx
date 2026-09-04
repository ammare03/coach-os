import { fireEvent, render, screen } from '@testing-library/react-native';

import { SegmentedControl, type SegmentedOptions } from './SegmentedControl.tsx';

describe('SegmentedControl', () => {
  const options: SegmentedOptions<'day' | 'week' | 'month'> = [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
  ];

  it('marks exactly one tab as selected', () => {
    render(<SegmentedControl options={options} value="week" onChange={jest.fn()} />);

    const tabs = screen.getAllByRole('tab');
    const selected = tabs.filter((tab) => tab.props.accessibilityState?.selected === true);

    expect(tabs).toHaveLength(3);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.props.accessibilityLabel).toBe('Week, tab 2 of 3');
  });

  it('fires onChange with the pressed option value', () => {
    const onChange = jest.fn();
    render(<SegmentedControl options={options} value="day" onChange={onChange} />);

    fireEvent.press(screen.getByLabelText('Month, tab 3 of 3'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('month');
  });

  it('does not change selection until the parent updates `value`', () => {
    const onChange = jest.fn();
    render(<SegmentedControl options={options} value="day" onChange={onChange} />);

    fireEvent.press(screen.getByLabelText('Week, tab 2 of 3'));

    // Uncontrolled components would flip immediately; this one is fully
    // controlled by `value`, so the selected tab has not moved yet.
    const selected = screen
      .getAllByRole('tab')
      .filter((tab) => tab.props.accessibilityState?.selected === true);
    expect(selected[0]?.props.accessibilityLabel).toBe('Day, tab 1 of 3');
  });

  it('rejects fewer than two or more than four options at the type level', () => {
    // @ts-expect-error — a single option is not a valid SegmentedOptions tuple
    const tooFew: SegmentedOptions<'a'> = [{ value: 'a', label: 'A' }];

    // @ts-expect-error — a fifth option is not a valid SegmentedOptions tuple
    const tooMany: SegmentedOptions<'a' | 'b' | 'c' | 'd' | 'e'> = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
      { value: 'c', label: 'C' },
      { value: 'd', label: 'D' },
      { value: 'e', label: 'E' },
    ];

    // Referenced so neither is reported as an unused variable; the
    // assertion under test is the `@ts-expect-error` above, checked by
    // `tsc --noEmit`, not by this runtime expectation.
    expect(tooFew.length + tooMany.length).toBeGreaterThan(0);
  });
});
