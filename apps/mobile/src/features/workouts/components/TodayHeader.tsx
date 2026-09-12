import { Skeleton, Text } from '@coachos/ui';
import { density, spacing, tapTarget } from '@coachos/ui/theme';
import { StyleSheet, View } from 'react-native';

import { SettingsAvatarButton } from '../../settings/components/SettingsAvatarButton.tsx';
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
  /**
   * The header's trailing-action slot. The client's ONE entry point into
   * settings (`settings-shell/02`) — deliberately not repeated on Nutrition,
   * Progress or Coach: a settings control on the Coach tab reads as
   * "settings for my coach", and four headers spent on a destination
   * visited once a month is four headers wasted.
   */
  onOpenSettings: () => void;
}

/** §3.6's header shape. The one skeleton outside the card. */
const SUBLINE_SKELETON_WIDTH = 168;
const SUBLINE_SKELETON_HEIGHT = 15;

export function TodayHeader({ header, isLoading, onOpenSettings }: TodayHeaderProps) {
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

      {/* The trailing-action slot. The button owns its own query, its own
          label and its own tap floor — this header only says where it sits
          and where the tap goes (`settings-shell/02`). */}
      <View style={styles.avatar}>
        <SettingsAvatarButton onPress={onOpenSettings} />
      </View>
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
