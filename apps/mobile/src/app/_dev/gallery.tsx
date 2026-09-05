import { NotFoundState } from '@coachos/ui';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';

import { GalleryScreen } from '../../dev/gallery/GalleryScreen.tsx';

// Second layer only. The real exclusion is `metro.config.js`, which blocks
// `src/app/_dev/**` and `src/dev/**` from the file map whenever the bundle is
// a release one — this file is not in a production bundle at all, so nothing
// below runs there. It exists because "dev tooling never ships" should not
// rest on a single mechanism: if a future Metro or expo-router change let the
// module through, the route still refuses rather than exposing the harness.
//
// `app.config.ts` computes the flag with the same predicate the Metro config
// uses (`dev-gallery.js`), so the two answers cannot disagree.
function isGalleryEnabled(): boolean {
  const extra: unknown = Constants.expoConfig?.extra;
  if (typeof extra !== 'object' || extra === null) return false;
  return 'devGalleryEnabled' in extra && extra.devGalleryEnabled === true;
}

export default function GalleryRoute() {
  const router = useRouter();

  if (!isGalleryEnabled()) {
    return <NotFoundState onRecover={() => router.back()} />;
  }

  return <GalleryScreen />;
}
