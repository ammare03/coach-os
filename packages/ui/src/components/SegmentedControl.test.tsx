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

  // The target sheet's intensity control: four ways to prescribe an
  // intensity, and no intensity at all is the absence of all four rather
  // than a fifth segment claiming to be a choice.
  it('marks nothing as selected when the value is null', () => {
    render(<SegmentedControl options={options} value={null} onChange={jest.fn()} />);

    const tabs = screen.getAllByRole('tab');

    expect(tabs).toHaveLength(3);
    expect(tabs.filter((tab) => tab.props.accessibilityState?.selected === true)).toHaveLength(0);
  });

  it('still reports the pressed option while nothing is selected', () => {
    const onChange = jest.fn();
    render(<SegmentedControl options={options} value={null} onChange={onChange} />);

    fireEvent.press(screen.getByLabelText('Week, tab 2 of 3'));

    expect(onChange).toHaveBeenCalledWith('week');
  });

  // `settings-shell/03`'s Light scheme: an option that exists, has no
  // designed palette behind it yet, and must say so rather than either
  // vanishing or silently doing nothing.
  describe('a disabled option', () => {
    const withDisabled: SegmentedOptions<'dark' | 'light'> = [
      { value: 'dark', label: 'Dark' },
      { value: 'light', label: 'Light', disabled: true },
    ];

    it('is announced as unavailable, not merely dimmed', () => {
      render(<SegmentedControl options={withDisabled} value="dark" onChange={jest.fn()} />);

      expect(screen.getByLabelText('Light, tab 2 of 2').props.accessibilityState).toMatchObject({
        selected: false,
        disabled: true,
      });
    });

    it('refuses the press outright — it never silently does nothing', () => {
      const onChange = jest.fn();
      render(<SegmentedControl options={withDisabled} value="dark" onChange={onChange} />);

      fireEvent.press(screen.getByLabelText('Light, tab 2 of 2'));

      expect(onChange).not.toHaveBeenCalled();
    });

    it('leaves every other segment pressable', () => {
      const onChange = jest.fn();
      render(<SegmentedControl options={withDisabled} value="light" onChange={onChange} />);

      fireEvent.press(screen.getByLabelText('Dark, tab 1 of 2'));

      expect(onChange).toHaveBeenCalledWith('dark');
    });

    it('reports every other segment as enabled, so the flag is visibly per-option', () => {
      render(<SegmentedControl options={withDisabled} value="dark" onChange={jest.fn()} />);

      expect(screen.getByLabelText('Dark, tab 1 of 2').props.accessibilityState).toMatchObject({
        disabled: false,
      });
    });
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
