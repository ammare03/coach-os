import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { NumberStepper, clampToPrecision, nextStepValue } from './NumberStepper.tsx';
import { REPEAT_CURVE } from './useLongPressRepeat.ts';

// A controlled host, because the component deliberately has no internal
// value state — testing it uncontrolled would test a shape the product
// never uses.
function Host({
  initial = 60,
  step = 2.5,
  min = 0,
  max = 300,
  onValue,
}: {
  initial?: number;
  step?: number;
  min?: number;
  max?: number;
  onValue?: (value: number) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <NumberStepper
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
      step={step}
      min={min}
      max={max}
      unit="kg"
      unitLabel="kilograms"
      accessibilityLabel="weight"
      testID="weight"
    />
  );
}

describe('nextStepValue', () => {
  // §5.2's `weight_kg` and `rpe numeric(3,1)` are exact columns; a stepper
  // that produced 82.30000000000001 would store it.
  it('takes a hundred 0.1 steps to exactly 10, with no floating-point residue', () => {
    let value = 0;
    for (let i = 0; i < 100; i += 1) {
      value = nextStepValue({ value, step: 0.1, direction: 1, min: 0, max: 1000, precision: 1 });
    }

    expect(value).toBe(10);
  });

  it('returns to the starting value after stepping up and back down', () => {
    let value = 6;
    for (let i = 0; i < 8; i += 1) {
      value = nextStepValue({ value, step: 0.5, direction: 1, min: 0, max: 10, precision: 1 });
    }
    for (let i = 0; i < 8; i += 1) {
      value = nextStepValue({ value, step: 0.5, direction: -1, min: 0, max: 10, precision: 1 });
    }

    expect(value).toBe(6);
  });

  it('clamps at max rather than overshooting', () => {
    expect(
      nextStepValue({ value: 299, step: 2.5, direction: 1, min: 0, max: 300, precision: 1 }),
    ).toBe(300);
  });

  it('clamps at min rather than going negative', () => {
    expect(
      nextStepValue({ value: 1, step: 2.5, direction: -1, min: 0, max: 300, precision: 1 }),
    ).toBe(0);
  });
});

describe('clampToPrecision', () => {
  it('snaps a typed value to the precision, not to the step', () => {
    expect(clampToPrecision(63.04, 0, 300, 1)).toBe(63);
    expect(clampToPrecision(63.06, 0, 300, 1)).toBe(63.1);
  });

  it('clamps a typed value into range', () => {
    expect(clampToPrecision(9000, 0, 300, 1)).toBe(300);
    expect(clampToPrecision(-5, 0, 300, 1)).toBe(0);
  });
});

describe('NumberStepper', () => {
  it('reaches a value one step away in one tap', () => {
    const onValue = jest.fn();
    render(<Host initial={60} onValue={onValue} />);

    fireEvent.press(screen.getByLabelText('Increase weight'));

    expect(onValue).toHaveBeenCalledWith(62.5);
    expect(screen.getByText('62.5')).toBeTruthy();
  });

  it('decrements by one step', () => {
    render(<Host initial={60} />);

    fireEvent.press(screen.getByLabelText('Decrease weight'));

    expect(screen.getByText('57.5')).toBeTruthy();
  });

  it('disables and announces the increase key at max', () => {
    const onValue = jest.fn();
    render(<Host initial={300} max={300} onValue={onValue} />);
    const increase = screen.getByLabelText('Increase weight');

    fireEvent.press(increase);

    expect(onValue).not.toHaveBeenCalled();
    expect(increase.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByLabelText('Decrease weight').props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });

  it('disables and announces the decrease key at min', () => {
    const onValue = jest.fn();
    render(<Host initial={0} min={0} onValue={onValue} />);
    const decrease = screen.getByLabelText('Decrease weight');

    fireEvent.press(decrease);

    expect(onValue).not.toHaveBeenCalled();
    expect(decrease.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('renders the value through Metric at one decimal for a 2.5 step', () => {
    render(<Host initial={60} />);

    expect(screen.getByText('60.0')).toBeTruthy();
    expect(screen.getByText('kg')).toBeTruthy();
  });

  // The single highest-value accessibility affordance in the product: a
  // screen-reader user swipes up and down and never hunts for a 52px key.
  it('exposes an adjustable value whose announcement carries the unit', () => {
    render(<Host initial={62.5} />);
    const value = screen.getByLabelText('weight');

    expect(value.props.accessibilityRole).toBe('adjustable');
    expect(value.props.accessibilityValue).toMatchObject({
      min: 0,
      max: 300,
      now: 62.5,
      text: '62.5 kilograms',
    });
  });

  it('changes the value from the increment and decrement accessibility actions', () => {
    const onValue = jest.fn();
    render(<Host initial={60} onValue={onValue} />);
    const value = screen.getByLabelText('weight');

    fireEvent(value, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onValue).toHaveBeenLastCalledWith(62.5);

    fireEvent(value, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(onValue).toHaveBeenLastCalledWith(60);
  });

  it('opens direct entry on the value and commits on submit', () => {
    const onValue = jest.fn();
    render(<Host initial={60} onValue={onValue} />);

    fireEvent.press(screen.getByLabelText('weight'));
    fireEvent.changeText(screen.getByTestId('weight-input'), '140');
    fireEvent(screen.getByTestId('weight-input'), 'submitEditing');

    expect(onValue).toHaveBeenCalledWith(140);
    expect(screen.getByText('140.0')).toBeTruthy();
  });

  it('commits a typed value on blur as well, so tapping away does not lose it', () => {
    const onValue = jest.fn();
    render(<Host initial={60} onValue={onValue} />);

    fireEvent.press(screen.getByLabelText('weight'));
    fireEvent.changeText(screen.getByTestId('weight-input'), '82.5');
    fireEvent(screen.getByTestId('weight-input'), 'blur');

    expect(onValue).toHaveBeenCalledTimes(1);
    expect(onValue).toHaveBeenCalledWith(82.5);
  });

  it('discards unparseable direct entry rather than writing NaN', () => {
    const onValue = jest.fn();
    render(<Host initial={60} onValue={onValue} />);

    fireEvent.press(screen.getByLabelText('weight'));
    fireEvent.changeText(screen.getByTestId('weight-input'), 'heavy');
    fireEvent(screen.getByTestId('weight-input'), 'blur');

    expect(onValue).not.toHaveBeenCalled();
    expect(screen.getByText('60.0')).toBeTruthy();
  });

  it('does not open a keyboard until the value is tapped', () => {
    render(<Host initial={60} />);

    expect(screen.queryByTestId('weight-input')).toBeNull();
  });

  it('blocks every path when disabled', () => {
    const onChange = jest.fn();
    render(
      <NumberStepper
        value={60}
        onChange={onChange}
        step={2.5}
        max={300}
        unit="kg"
        isDisabled
        accessibilityLabel="weight"
        testID="weight"
      />,
    );

    fireEvent.press(screen.getByLabelText('Increase weight'));
    fireEvent.press(screen.getByLabelText('Decrease weight'));
    fireEvent.press(screen.getByLabelText('weight'));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId('weight-input')).toBeNull();
  });

  it('renders reps, RPE and calorie configurations at both densities', () => {
    expect(() =>
      render(
        <>
          <NumberStepper
            value={8}
            onChange={jest.fn()}
            step={1}
            max={50}
            accessibilityLabel="reps"
          />
          <NumberStepper
            value={8}
            onChange={jest.fn()}
            step={0.5}
            min={1}
            max={10}
            density="coach"
            accessibilityLabel="RPE"
          />
          <NumberStepper
            value={480}
            onChange={jest.fn()}
            step={10}
            max={5000}
            unit="kcal"
            accessibilityLabel="calories"
          />
        </>,
      ),
    ).not.toThrow();
  });

  describe('long press', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('repeats while held and lands no extra step once the finger lifts', () => {
      const onValue = jest.fn();
      render(<Host initial={60} onValue={onValue} />);
      const increase = screen.getByLabelText('Increase weight');

      fireEvent(increase, 'pressIn');
      act(() => {
        jest.advanceTimersByTime(REPEAT_CURVE.initialDelayMs + REPEAT_CURVE.startIntervalMs);
      });
      const repeats = onValue.mock.calls.length;
      expect(repeats).toBeGreaterThanOrEqual(2);

      fireEvent(increase, 'pressOut');
      fireEvent.press(increase);
      act(() => {
        jest.advanceTimersByTime(5_000);
      });

      expect(onValue).toHaveBeenCalledTimes(repeats);
    });

    it('still steps once for a tap shorter than the initial delay', () => {
      const onValue = jest.fn();
      render(<Host initial={60} onValue={onValue} />);
      const increase = screen.getByLabelText('Increase weight');

      fireEvent(increase, 'pressIn');
      act(() => {
        jest.advanceTimersByTime(80);
      });
      fireEvent(increase, 'pressOut');
      fireEvent.press(increase);

      expect(onValue).toHaveBeenCalledTimes(1);
      expect(onValue).toHaveBeenCalledWith(62.5);
    });

    it('stops cleanly at max without stuttering past it', () => {
      const onValue = jest.fn();
      render(<Host initial={290} max={300} onValue={onValue} />);
      const increase = screen.getByLabelText('Increase weight');

      fireEvent(increase, 'pressIn');
      act(() => {
        jest.advanceTimersByTime(5_000);
      });
      fireEvent(increase, 'pressOut');

      expect(onValue).toHaveBeenLastCalledWith(300);
      expect(screen.getByText('300.0')).toBeTruthy();
    });
  });
});
