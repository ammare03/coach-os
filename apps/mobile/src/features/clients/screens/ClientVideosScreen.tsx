import { createThemedStyles } from '@coachos/ui';
import { StyleSheet, View } from 'react-native';

import type { ClientFormCheck } from '../ClientVideosContract.ts';
import { clientVideosQueryKey } from '../ClientVideosContract.ts';
import { ClientVideosGrid } from '../components/ClientVideosGrid.tsx';

// §8.3's Videos facet: "grid of form-check uploads, unreviewed first."
//
// **A forward hook, and the shell is the whole deliverable.** The facet, its
// cache key, the grid geometry, and the empty state ship in P10;
// `phase-11-media-pipeline/playback/` ships the procedure that fills it. Until
// then there is no query behind this screen at all, so the empty state is the
// only state it can reach — and it is also the permanent state for a client
// who has never filmed a set, which is why it is designed rather than a
// placeholder (the P10 README, "the same pattern, four times").
//
// **`ClientVideosContract.ts` is the file to read before wiring P11.** It
// carries, in full: the unreviewed-first `ORDER BY` (DB§22's `NOT EXISTS`
// pattern — two keys, and the first one is the feature), the per-tile payload
// that keeps a query out of a list row, and why a signed R2 URL must never be
// on that payload. The headline, so it cannot be missed from here:
//
//   ORDER BY (NOT EXISTS (SELECT 1 FROM coaching.comments c
//                          WHERE c.target_type = 'media_asset'
//                            AND c.target_id = ma.id)) DESC,
//            ma.created_at DESC, ma.id DESC
//
// **Wiring P11 is three edits and none of them is in this file's layout.**
// Replace `NO_VIDEOS_YET` with the query's data, add the loading and error
// branches below (`LoadingState shape="list"` and the same two-state failure
// `ClientOverviewScreen` renders — `NOT_YOUR_CLIENT` → `NotFoundState`, never
// `ForbiddenState`, per `ERRORS.md` ER§2.1), and give `ClientVideosTile` its
// press handler. Nothing in `ClientVideosGrid` or `ClientVideosTile` changes
// shape.
//
// **No loading, error, or forbidden state ships here**, and that is not a
// missing `ui-conventions` §4 requirement: this screen loads no data, so it
// has nothing to be pending or to fail at. The facet bar and the back control
// live in `_layout.tsx` above it and survive regardless, which is the property
// `screen-composition` §3 is actually protecting.

/**
 * The empty array this screen renders until P11 exists — module scope, so it
 * is referentially stable and the grid is not re-rendered by a fresh `[]` on
 * every pass (`frontend-performance` §3).
 */
const NO_VIDEOS_YET: readonly ClientFormCheck[] = [];

export interface ClientVideosScreenProps {
  clientId: string;
}

export function ClientVideosScreen({ clientId }: ClientVideosScreenProps) {
  const themed = useThemedStyles();

  // P11 replaces this line with
  //   const videos = useQuery({ queryKey: clientVideosQueryKey(clientId), … })
  // and nothing else on this screen moves. The key itself lives in
  // `ClientVideosContract.ts` and is pinned by this screen's test, so it
  // cannot be invented a second time when the query arrives.
  const videos = NO_VIDEOS_YET;

  return (
    <View style={[styles.flex, themed.screen]} testID="client-videos">
      {/* Keyed on the cache key rather than mounted bare: two clients are two
          lists, and a recycler that survives the switch would show the
          previous client's scroll offset — and, once P11 lands, their frames
          for a frame. */}
      <ClientVideosGrid key={clientVideosQueryKey(clientId).join('/')} videos={videos} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});

const useThemedStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.colors.bg.DEFAULT },
}));
