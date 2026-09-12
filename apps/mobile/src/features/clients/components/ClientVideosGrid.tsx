import { density, spacing } from '@coachos/ui';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import type { ClientFormCheck } from '../ClientVideosContract.ts';

import { ClientVideosEmpty } from './ClientVideosEmpty.tsx';
import { ClientVideosTile } from './ClientVideosTile.tsx';

// §8.3's "grid of form-check uploads", as the permanent shell
// `phase-11-media-pipeline/playback/` fills. Everything geometric is decided
// here and exported, so P11 drops real thumbnails into a layout that is
// already right rather than re-deriving a tile size from a screenshot.
//
// **The array is rendered in the order it arrives, and this component never
// sorts.** The unreviewed-first ordering is the server's, stated in full in
// `ClientVideosContract.ts`; a second ordering in JS would be a second
// implementation to keep in sync and would disagree with the keyset page
// boundary the moment P11 adds pagination.
//
// **`FlashList` v2, and deliberately no size prop.** `CLAUDE.md` §25.8's
// warning ("FlashList needs `estimatedItemSize`") is a v1 rule: the prop does
// not exist in 2.0.2, because v2's recycler measures rows itself. What §25.8
// protects is honoured one layer down — every cell here is the same height by
// construction, since the frame is a fixed aspect ratio and both caption lines
// are `numberOfLines={1}`, so the first layout pass measures a stable box.

/**
 * Two columns. Not three: at the coach gutter a third column puts the tile
 * under 115pt, which is below the size at which a coach can tell one squat
 * from another — and telling them apart is the only thing a thumbnail is for.
 */
export const CLIENT_VIDEOS_COLUMNS = 2;

/**
 * **Row gap is wider than column gap, and that is not a slip.** A caption sits
 * under every tile, so at an equal gap the words read as belonging to the tile
 * *below* them. 11 across, 16 down.
 */
export const CLIENT_VIDEOS_COLUMN_GAP = 11;
export const CLIENT_VIDEOS_ROW_GAP = 16;

const GUTTER = density.coach.gutter;

export interface ClientVideosGridProps {
  /**
   * Already sorted by the server (`ClientVideosContract.ts`). Empty renders the
   * designed empty state, which in P10 is the only state this grid reaches.
   */
  videos: readonly ClientFormCheck[];
  /** Injected so the relative captions are deterministic under test. */
  now?: Date | undefined;
}

function keyExtractor(video: ClientFormCheck) {
  return video.mediaAssetId;
}

export function ClientVideosGrid({ videos, now }: ClientVideosGridProps) {
  // Stable across renders, so `ClientVideosTile`'s `memo` is not defeated by a
  // new arrow per cell (`frontend-performance` §3).
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ClientFormCheck>) => (
      <View style={styles.cell}>
        <ClientVideosTile video={item} now={now} />
      </View>
    ),
    [now],
  );

  // Not `ListEmptyComponent`: the empty state is optically centred in the
  // facet, and a list's empty slot sits under the content padding at the top
  // of a scroll view it then has no reason to be. A zero-row FlashList is a
  // ScrollView with extra machinery either way.
  if (videos.length === 0) {
    return (
      <View style={styles.empty} testID="client-videos-grid-empty">
        <ClientVideosEmpty />
      </View>
    );
  }

  return (
    <FlashList
      data={videos}
      numColumns={CLIENT_VIDEOS_COLUMNS}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      // The gutter is halved on the container and made up by each cell's own
      // horizontal padding, which is how a multi-column FlashList gets an even
      // gap between columns without a per-index margin that breaks on recycle.
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      testID="client-videos-grid"
    />
  );
}

const HALF_COLUMN_GAP = CLIENT_VIDEOS_COLUMN_GAP / 2;

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: GUTTER - HALF_COLUMN_GAP,
    paddingTop: spacing(14),
    paddingBottom: spacing(40),
  },
  cell: { paddingHorizontal: HALF_COLUMN_GAP, paddingBottom: CLIENT_VIDEOS_ROW_GAP },
  // `paddingBottom` on a centring box lifts the block above the true middle —
  // optical centring, since the facet bar above it is visual weight the empty
  // block below has no counterpart for.
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: spacing(52),
  },
});
