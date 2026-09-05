import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GalleryScreen } from '../GalleryScreen.tsx';
import { GALLERY_SECTIONS } from '../sections/registry.ts';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function renderGallery() {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <GalleryScreen />
    </SafeAreaProvider>,
  );
}

describe('GalleryScreen', () => {
  // A section that throws is replaced by `SectionBoundary`'s fallback, so
  // finding every title is the same assertion as "no primitive blew up".
  it('renders every section', () => {
    renderGallery();

    for (const { name } of GALLERY_SECTIONS) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });

  it('scales every section at once, from the route-level toggle', () => {
    renderGallery();
    const title = screen.getByText('Adherence');

    expect(StyleSheet.flatten(title.props.style)).toBeUndefined();

    fireEvent.press(screen.getByText('200%'));

    // `h2` is 21/25 in tokens.ts, and `GallerySection` renders its title at
    // that size — so 200% is 42.
    expect(StyleSheet.flatten(screen.getByText('Adherence').props.style)).toMatchObject({
      fontSize: 42,
      lineHeight: 50,
    });
  });

  it('switches scheme for every section at once', () => {
    renderGallery();

    fireEvent.press(screen.getByText('Light'));

    // Still mounted, still one tree — the scheme is a prop on one provider,
    // not a per-component toggle.
    expect(screen.getByText('Adherence')).toBeTruthy();
  });
});
