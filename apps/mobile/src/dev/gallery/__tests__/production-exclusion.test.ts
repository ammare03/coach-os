import path from 'node:path';

import { isDevGalleryEnabled } from '../../../../dev-gallery.js';

const PROJECT_ROOT = path.resolve(__dirname, '../../../..');
const GALLERY_FILES = [
  path.join(PROJECT_ROOT, 'src', 'app', '_dev', 'gallery.tsx'),
  path.join(PROJECT_ROOT, 'src', 'dev', 'gallery', 'GalleryScreen.tsx'),
];
const APP_FILE = path.join(PROJECT_ROOT, 'src', 'app', 'index.tsx');

/** Metro accepts one RegExp or a list; normalise so the assertions read the same either way. */
function blockListOf(config: { resolver?: { blockList?: unknown } }): RegExp[] {
  const raw = config.resolver?.blockList;
  if (Array.isArray(raw)) return raw.filter((entry): entry is RegExp => entry instanceof RegExp);
  return raw instanceof RegExp ? [raw] : [];
}

type MetroConfig = { resolver?: { blockList?: unknown } };

function loadMetroConfig(nodeEnv: 'development' | 'production'): MetroConfig {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;

  try {
    let config: MetroConfig = {};
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      config = require('../../../../metro.config.js') as MetroConfig;
    });
    return config;
  } finally {
    process.env.NODE_ENV = previous;
  }
}

describe('isDevGalleryEnabled', () => {
  it('is off for a release bundle', () => {
    expect(isDevGalleryEnabled({ NODE_ENV: 'production' })).toBe(false);
  });

  it('is on for a development bundle', () => {
    expect(isDevGalleryEnabled({ NODE_ENV: 'development' })).toBe(true);
  });

  // The escape hatch exists so an internal preview build can carry the
  // gallery. The production profile must never set it.
  it('is on for a release bundle that opted in explicitly', () => {
    expect(isDevGalleryEnabled({ NODE_ENV: 'production', EXPO_PUBLIC_DEV_GALLERY: '1' })).toBe(
      true,
    );
  });

  it('treats any other value of the opt-in as not opting in', () => {
    expect(isDevGalleryEnabled({ NODE_ENV: 'production', EXPO_PUBLIC_DEV_GALLERY: 'true' })).toBe(
      false,
    );
  });
});

// The acceptance criterion is that the route is ABSENT from a production
// build, not merely unlinked — expo-router's require.context matches every
// `.tsx` under the app root and does not filter `_`-prefixed directories, so
// the blockList is the only thing standing between `_dev/gallery.tsx` and a
// store build.
describe('metro.config.js blockList', () => {
  it('blocks every gallery file when NODE_ENV is production', () => {
    const blocked = blockListOf(loadMetroConfig('production'));

    for (const file of GALLERY_FILES) {
      expect(blocked.some((pattern) => pattern.test(file))).toBe(true);
    }
  });

  it('leaves the rest of the app reachable', () => {
    const blocked = blockListOf(loadMetroConfig('production'));

    expect(blocked.some((pattern) => pattern.test(APP_FILE))).toBe(false);
  });

  it('blocks nothing extra in development', () => {
    const blocked = blockListOf(loadMetroConfig('development'));

    for (const file of GALLERY_FILES) {
      expect(blocked.some((pattern) => pattern.test(file))).toBe(false);
    }
  });
});
