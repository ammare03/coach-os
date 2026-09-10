import { Avatar, Pressable, Skeleton, Text } from '@coachos/ui';
import { density, spacing, tapTarget } from '@coachos/ui/theme';
import { StyleSheet, View } from 'react-native';

import { api } from '../../../lib/trpc.ts';
import type { TodayHeaderContext } from '../hooks/useTodaySession.ts';

// Frame `I` (`today-card/DESIGN-SPEC.md` §3.10). **The date is the title.
// There is no screen name, ever** (`docs/screens/client-today.md`).
//
// The sub-line degrades by DROPPING SEGMENTS, never by inventing
// placeholders: no week data drops "Week n of m", no coach drops the whole
// line and the header collapses to one row. Never "Week — of —", never
// "No coach".
//
// The avatar is the CLIENT'S OWN, so it has no coach dependency and never
// disappears — which is also why this header cannot fail as a section: its
// only unconditional content is a date, and a date needs no query.

export interface TodayHeaderProps {
  header: TodayHeaderContext;
  /** True while the card is still resolving and the sub-line has nothing to say yet. */
  isLoading: boolean;
  onOpenSettings: () => void;
}

/** §3.6's header shape. The one skeleton outside the card. */
const SUBLINE_SKELETON_WIDTH = 168;
const SUBLINE_SKELETON_HEIGHT = 15;

export function TodayHeader({ header, isLoading, onOpenSettings }: TodayHeaderProps) {
  const me = api.me.get.useQuery();
  const subLine = composeSubLine(header);

  return (
    <View style={styles.header}>
      <View style={styles.words}>
        {/* `minHeight`, never `height`, and no `numberOfLines` on either
            line: at 200% text the header wraps and grows (§4, frame `I`
            case 4). */}
        <Text size="h1-client" accessibilityRole="header">
          {header.dateLabel}
        </Text>
        {subLine ? (
          <Text size="body" tone="muted" style={styles.subLine}>
            {subLine}
          </Text>
        ) : isLoading ? (
          <Skeleton
            width={SUBLINE_SKELETON_WIDTH}
            height={SUBLINE_SKELETON_HEIGHT}
            radius="chip"
            style={styles.subLine}
          />
        ) : null}
      </View>

      <Pressable
        onPress={onOpenSettings}
        accessibilityRole="button"
        accessibilityLabel="Settings"
        style={styles.avatar}
      >
        {/* `Avatar` hides itself from the reading order — the pressable
            around it carries the label (its own accessibility contract).
            No `uri`: resolving `users.avatar_asset_id` to a signed URL is
            `phase-11-media-pipeline`'s, and the initials fallback renders
            unconditionally underneath one anyway. */}
        <Avatar
          name={me.data?.name ?? ''}
          userId={me.data?.id ?? 'pending'}
          size="md"
          recyclingKey={me.data?.id ?? 'pending'}
        />
      </Pressable>
    </View>
  );
}

/**
 * `Week 6 of 12 · with Marcus` → `with Marcus` → nothing. Exported for its
 * own test: every degradation step is a copy rule, not a layout detail.
 */
export function composeSubLine(header: TodayHeaderContext): string | null {
  const segments: string[] = [];
  if (header.weekNumber !== null && header.totalWeeks !== null) {
    segments.push(`Week ${String(header.weekNumber)} of ${String(header.totalWeeks)}`);
  }
  if (header.coachFirstName !== null) segments.push(`with ${header.coachFirstName}`);
  return segments.length === 0 ? null : segments.join(' · ');
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing(12),
    paddingTop: spacing(6),
    paddingHorizontal: density.client.gutter,
    paddingBottom: spacing(18),
  },
  words: {
    flex: 1,
    minWidth: 0,
    // §3.10 — `minHeight`, never `height`.
    minHeight: tapTarget.MIN,
    justifyContent: 'center',
  },
  subLine: {
    marginTop: spacing(3),
    // The sub-line carries "Week 6 of 12".
    fontVariant: ['tabular-nums'],
  },
  avatar: {
    // 48px already clears the 44 floor, so no `hitSlop` is needed here.
    alignSelf: 'center',
  },
});
