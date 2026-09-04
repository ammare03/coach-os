import { render, screen } from '@testing-library/react-native';

import { Metric } from './Metric.tsx';

describe('Metric', () => {
  it('applies tabular numerals unconditionally, with no prop to disable them', () => {
    render(<Metric testID="m" value={60} />);
    // No `tabularNums`/`disableTabularNums` prop exists on `MetricProps` —
    // this is a runtime check that the style is always present, not that a
    // caller opted in (theme-tokens/03 acceptance criteria).
    const view = screen.getByTestId('m');
    const valueText = view.findByProps({ children: 60 });
    expect(valueText.props.style).toEqual(
      expect.objectContaining({ fontVariant: ['tabular-nums'] }),
    );
  });

  it('renders the unit one scale step down from the value, in a muted tone', () => {
    render(<Metric value={60} unit="kg" size="metric" />);
    const unitText = screen.getByText('kg');
    expect(unitText.props.className).toContain('text-metric-sm');
    expect(unitText.props.className).toContain('text-fg-muted');
  });

  it('renders no unit element when unit is omitted', () => {
    render(<Metric value={60} />);
    expect(screen.queryByText('kg')).toBeNull();
  });
});
