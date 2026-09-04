import type { AdherenceState } from '@coachos/utils';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { colors } from '../theme/tokens.ts';

import { AdherenceDot } from './AdherenceDot.tsx';

// The dot itself is the only child of the labelled wrapper — reading its
// flattened style is how the state -> token -> second-channel mapping gets
// asserted without a snapshot (`testing` §9 bans those).
function dotStyle(label: string): ViewStyle {
  const wrapper = screen.getByLabelText(label);
  const dot = wrapper.children[0];
  if (dot === undefined || typeof dot === 'string' || !('props' in dot)) {
    throw new Error('AdherenceDot rendered no dot view');
  }
  return StyleSheet.flatten(dot.props.style as ViewStyle);
}

describe('AdherenceDot', () => {
  it.each<[AdherenceState, string, string]>([
    ['on-track', 'On plan', colors.state.onPlan],
    ['drifting', 'Drifting', colors.state.drifting],
    ['off-track', 'Off plan', colors.state.offPlan],
    ['no-data', 'Not started', colors.state.notStarted],
  ])('maps %s to its DESIGN.md §8 token and announces it', (state, label, token) => {
    render(<AdherenceDot state={state} />);

    expect(dotStyle(label).borderColor).toBe(token);
  });

  // The redundant, non-colour channel. If these four assertions are ever
  // relaxed, the component works only for coaches with typical colour
  // vision (`ui-conventions` §8).
  it('fills the on-plan dot solid', () => {
    render(<AdherenceDot state="on-track" />);

    const style = dotStyle('On plan');
    expect(style.backgroundColor).toBe(colors.state.onPlan);
    expect(style.borderStyle).toBe('solid');
  });

  it.each<[AdherenceState, string]>([
    ['drifting', 'Drifting'],
    ['off-track', 'Off plan'],
  ])('renders %s as a hollow solid ring', (state, label) => {
    render(<AdherenceDot state={state} />);

    const style = dotStyle(label);
    expect(style.backgroundColor).toBeUndefined();
    expect(style.borderStyle).toBe('solid');
  });

  // `not-started` and `off-plan` are within 0.006 of each other in relative
  // luminance, so the dash is the ONLY thing separating them once the screen
  // is desaturated. It is not decoration.
  it('renders not-started as a dashed grey ring, never red and never filled', () => {
    render(<AdherenceDot state="no-data" />);

    const style = dotStyle('Not started');
    expect(style.borderStyle).toBe('dashed');
    expect(style.backgroundColor).toBeUndefined();
    expect(style.borderColor).toBe(colors.state.notStarted);
    expect(style.borderColor).not.toBe(colors.state.offPlan);
  });

  it('gives not-started no glow, so absence never draws the eye like failure does', () => {
    render(<AdherenceDot state="no-data" />);

    expect(dotStyle('Not started').shadowOpacity).toBeUndefined();
  });

  it('draws both sizes at the prototype diameters and never shrinks the ring', () => {
    const { rerender } = render(<AdherenceDot state="on-track" size="sm" />);
    expect(dotStyle('On plan')).toMatchObject({ width: 11, height: 11, borderWidth: 1.5 });

    rerender(<AdherenceDot state="on-track" size="md" />);
    expect(dotStyle('On plan')).toMatchObject({ width: 12, height: 12, borderWidth: 1.5 });
  });

  it('renders the key label beside the dot and announces it instead of the bare state', () => {
    render(<AdherenceDot state="drifting" label="Drifting · 3 clients" />);

    expect(screen.getByText('Drifting · 3 clients')).toBeTruthy();
    expect(screen.queryByLabelText('Drifting')).toBeNull();
  });

  it('is not a button unless it is given something to do', () => {
    render(<AdherenceDot state="on-track" />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('becomes a button with a 44px hit area when interactive', () => {
    const onPress = jest.fn();
    render(<AdherenceDot state="off-track" onPress={onPress} />);

    const button = screen.getByRole('button', { name: 'Off plan' });
    // (44 - 12) / 2 on each edge takes a 12px dot to the DESIGN.md §13 floor.
    expect(button.props.hitSlop).toBe(16);

    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
