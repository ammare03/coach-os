import { DEFAULT_THEME } from '@coachos/ui/theme';
import { render, screen, within } from '@testing-library/react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { DockSelectionPill } from '../DockSelectionPill.tsx';

describe('DockSelectionPill', () => {
  it('paints the theme selection-pill gradient top to bottom', () => {
    // `DESIGN.md` §4 — the pill is a 180° gradient, and React Native has no
    // CSS gradient, so a flat `backgroundColor` here would be a silent
    // downgrade of the material.
    render(<DockSelectionPill cornerRadius={32} testID="pill" />);

    const gradient = within(screen.getByTestId('pill')).UNSAFE_getByType(LinearGradient);
    expect(gradient.props.colors).toEqual(DEFAULT_THEME.selectionPill.gradient);
    expect(gradient.props.start).toEqual({ x: 0, y: 0 });
    expect(gradient.props.end).toEqual({ x: 0, y: 1 });
  });

  it('draws §12 faked inset hairline, since RN has no inset box-shadow', () => {
    render(<DockSelectionPill cornerRadius={32} testID="pill" />);

    const hairlines = within(screen.getByTestId('pill'))
      .UNSAFE_getAllByType(View)
      .map((node) => StyleSheet.flatten(node.props.style))
      .filter((style) => style?.height === 1);

    expect(hairlines).toHaveLength(1);
    expect(hairlines[0]).toMatchObject({
      backgroundColor: DEFAULT_THEME.selectionPill.highlight,
      top: 0,
    });
  });

  it('wears the drop shadow on a view that does not clip it', () => {
    // `overflow: 'hidden'` and a shadow on the same view swallow the shadow
    // on iOS. The material clips one layer in, so the two never share a node.
    render(<DockSelectionPill cornerRadius={32} testID="pill" />);

    const outer = StyleSheet.flatten(screen.getByTestId('pill').props.style);

    expect(outer).toMatchObject(DEFAULT_THEME.selectionPill.shadow);
    expect(outer.overflow).toBeUndefined();
  });

  it('clips the material to the corner radius the caller names', () => {
    render(<DockSelectionPill cornerRadius={26} testID="pill" />);

    const clips = within(screen.getByTestId('pill'))
      .UNSAFE_getAllByType(View)
      .map((node) => StyleSheet.flatten(node.props.style))
      .filter((style) => style?.overflow === 'hidden');

    expect(clips).toHaveLength(1);
    expect(clips[0]?.borderRadius).toBe(26);
  });

  it('fills the box the caller positions and animates, and owns no position of its own', () => {
    // The two docks move the pill differently — the coach cross-fades one
    // per item, the client slides a single one across the row — so position
    // and motion stay with the caller and only the material is shared.
    render(<DockSelectionPill cornerRadius={32} testID="pill" />);

    const outer = StyleSheet.flatten(screen.getByTestId('pill').props.style);

    expect(outer).toMatchObject({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 });
  });

  it('stays out of the touch path and out of the reading order', () => {
    render(<DockSelectionPill cornerRadius={32} testID="pill" />);

    expect(screen.getByTestId('pill').props.pointerEvents).toBe('none');
  });
});
