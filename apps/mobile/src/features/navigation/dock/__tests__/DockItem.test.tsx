import { DEFAULT_THEME } from '@coachos/ui/theme';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { House } from 'lucide-react-native';
import { StyleSheet, Text as RNText, View } from 'react-native';
import { Svg } from 'react-native-svg';

import { DockItem, type DockItemGeometry, type DockItemProps } from '../DockItem.tsx';

// A geometry that shares no value with either real dock, so an assertion
// below can only pass by reading the prop rather than by coinciding with a
// constant `DockItem` kept for itself.
const GEOMETRY: DockItemGeometry = {
  itemHeight: 52,
  itemGap: 3,
  iconSize: 23,
  iconStrokeWidth: 1.7,
  pressScale: 0.95,
  labelTracking: 0.19,
  labelMaxFontScale: 1.5,
  hitSlop: { top: 7, bottom: 7, left: 4, right: 4 },
};

const BASE: DockItemProps = {
  geometry: GEOMETRY,
  Icon: House,
  label: 'Today',
  focused: false,
  accessibilityLabel: 'Today, tab 1 of 4',
  onPress: () => {},
  testID: 'dock-item',
  iconTestID: 'dock-item-icon',
};

function renderItem(overrides: Partial<DockItemProps> = {}) {
  return render(<DockItem {...BASE} {...overrides} />);
}

describe('DockItem', () => {
  it('renders the glyph AND the label, never a glyph alone', () => {
    // `DESIGN.md` §13 — an icon never travels alone in navigation. Asserted
    // inside the item, so removing either channel fails here.
    renderItem();

    const item = within(screen.getByTestId('dock-item'));
    expect(item.getByTestId('dock-item-icon')).toBeTruthy();
    expect(item.getByText('Today')).toBeTruthy();
  });

  it('exposes the tab role, the supplied name, and its selected state', () => {
    renderItem({ focused: true });

    const tab = screen.getByRole('tab');
    expect(tab.props.accessibilityLabel).toBe('Today, tab 1 of 4');
    expect(tab.props.accessibilityState).toMatchObject({ selected: true });
  });

  it('reports itself unselected when it is not the focused item', () => {
    renderItem();

    expect(screen.getByRole('tab').props.accessibilityState).toMatchObject({ selected: false });
  });

  it('draws the glyph at the size and stroke width the geometry names', () => {
    renderItem();

    const svg = within(screen.getByTestId('dock-item-icon')).UNSAFE_getByType(Svg);
    expect(svg.props.width).toBe(GEOMETRY.iconSize);
    expect(svg.props.height).toBe(GEOMETRY.iconSize);
    expect(svg.props.strokeWidth).toBe(GEOMETRY.iconStrokeWidth);
  });

  it('brightens the glyph when focused and mutes it when not', () => {
    renderItem();

    const muted = within(screen.getByTestId('dock-item-icon')).UNSAFE_getByType(Svg);
    expect(muted.props.stroke).toBe(DEFAULT_THEME.colors.fg.muted);

    screen.rerender(<DockItem {...BASE} focused />);

    const bright = within(screen.getByTestId('dock-item-icon')).UNSAFE_getByType(Svg);
    expect(bright.props.stroke).toBe(DEFAULT_THEME.colors.fg.bright);
  });

  it('takes its tappable overflow from the hit slop the geometry names', () => {
    renderItem();

    expect(screen.getByTestId('dock-item').props.hitSlop).toEqual(GEOMETRY.hitSlop);
  });

  it('omits hit slop entirely for a dock whose items already fill the row', () => {
    const { hitSlop: _unused, ...noSlop } = GEOMETRY;
    renderItem({ geometry: noSlop });

    expect(screen.getByTestId('dock-item').props.hitSlop).toBeUndefined();
  });

  it('floors the item box rather than fixing it, so the label may grow', () => {
    // `accessibility` §3 — min-height, never height. A fixed 52 clips the
    // label at a large OS text size instead of letting the item report a
    // taller measurement.
    renderItem();

    const style = StyleSheet.flatten(
      within(screen.getByTestId('dock-item')).UNSAFE_getByType(View).props.style,
    );
    expect(style.minHeight).toBe(GEOMETRY.itemHeight);
    expect(style.height).toBeUndefined();
    expect(style.gap).toBe(GEOMETRY.itemGap);
  });

  it('calls onPress and onLongPress', () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    renderItem({ onPress, onLongPress });

    fireEvent.press(screen.getByRole('tab'));
    fireEvent(screen.getByRole('tab'), 'longPress');

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('caps the label font scaling at the multiplier the geometry names', () => {
    renderItem();

    expect(screen.getByText('Today').props.maxFontSizeMultiplier).toBe(GEOMETRY.labelMaxFontScale);
  });

  it('applies the label tracking the geometry names', () => {
    renderItem();

    expect(StyleSheet.flatten(screen.getByText('Today').props.style)).toMatchObject({
      letterSpacing: GEOMETRY.labelTracking,
    });
  });

  it('sets no tracking at all when the geometry asks for none', () => {
    renderItem({ geometry: { ...GEOMETRY, labelTracking: 0 } });

    const style = StyleSheet.flatten(screen.getByText('Today').props.style) ?? {};
    expect(style.letterSpacing).toBeUndefined();
  });
});

describe('DockItem slots', () => {
  it('renders a pill behind the glyph and the label', () => {
    renderItem({ pill: <View testID="slot-pill" /> });

    // The pill is the item's background: it must be drawn before the
    // content, not over it.
    const content = within(screen.getByTestId('dock-item')).UNSAFE_getByType(View).props.children;
    const rendered = Array.isArray(content) ? content.flat() : [content];
    const pillPosition = rendered.findIndex(
      (child: { props?: { testID?: string } }) => child?.props?.testID === 'slot-pill',
    );
    const glyphPosition = rendered.findIndex(
      (child: { props?: { testID?: string } }) => child?.props?.testID === 'dock-item-icon',
    );

    expect(pillPosition).toBeGreaterThanOrEqual(0);
    expect(pillPosition).toBeLessThan(glyphPosition);
  });

  it('anchors a glyph accessory inside the glyph box, so it tracks the icon', () => {
    renderItem({ glyphAccessory: <RNText testID="slot-glyph">3</RNText> });

    expect(within(screen.getByTestId('dock-item-icon')).getByTestId('slot-glyph')).toBeTruthy();
  });

  it('anchors an item accessory to the item box, outside the glyph', () => {
    renderItem({ itemAccessory: <RNText testID="slot-item">3</RNText> });

    expect(within(screen.getByTestId('dock-item')).getByTestId('slot-item')).toBeTruthy();
    expect(within(screen.getByTestId('dock-item-icon')).queryByTestId('slot-item')).toBeNull();
  });

  it('renders no slot content when none is supplied', () => {
    renderItem();

    expect(screen.queryByTestId('slot-pill')).toBeNull();
    expect(screen.queryByTestId('slot-glyph')).toBeNull();
    expect(screen.queryByTestId('slot-item')).toBeNull();
  });
});

describe('DockItem on a non-tab surface', () => {
  // `DESIGN.md` §9's Action bar is the next Tier-1 consumer of this item
  // (UNFORGET S11). Its entries are buttons in a toolbar, not tabs in a
  // tablist, and nothing else about the item changes.
  it('takes the button role without losing its label or its glyph', () => {
    renderItem({ accessibilityRole: 'button', accessibilityLabel: 'Add a set' });

    const button = screen.getByRole('button');
    expect(button.props.accessibilityLabel).toBe('Add a set');
    expect(screen.queryByRole('tab')).toBeNull();
    expect(within(screen.getByTestId('dock-item')).getByText('Today')).toBeTruthy();
  });
});
