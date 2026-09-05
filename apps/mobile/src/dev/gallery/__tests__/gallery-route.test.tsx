import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import GalleryRoute from '../../../app/_dev/gallery.tsx';

const mockExtra: { devGalleryEnabled?: unknown } = {};

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: mockExtra };
    },
  },
}));

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function renderRoute() {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <GalleryRoute />
    </SafeAreaProvider>,
  );
}

afterEach(() => {
  delete mockExtra.devGalleryEnabled;
});

// The bundle exclusion in `metro.config.js` is the real mechanism; this is
// the layer that has to hold if the module ever reaches a release build
// anyway. It refuses on anything that is not literally `true`.
describe('the /_dev/gallery route', () => {
  it('renders the gallery when the build enabled it', () => {
    mockExtra.devGalleryEnabled = true;
    renderRoute();

    expect(screen.getByText('Component gallery · dev only')).toBeTruthy();
  });

  it('refuses when the flag is false', () => {
    mockExtra.devGalleryEnabled = false;
    renderRoute();

    expect(screen.queryByText('Component gallery · dev only')).toBeNull();
  });

  it('refuses when the flag is missing entirely', () => {
    renderRoute();

    expect(screen.queryByText('Component gallery · dev only')).toBeNull();
  });

  it('refuses on a truthy value that is not the boolean', () => {
    mockExtra.devGalleryEnabled = 'true';
    renderRoute();

    expect(screen.queryByText('Component gallery · dev only')).toBeNull();
  });
});
