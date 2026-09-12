import {
  ADHERENCE_STATE_LABEL,
  AdherenceDot,
  Avatar,
  Badge,
  Pressable,
  Text,
  createThemedStyles,
  createThemedValue,
  fontSize,
  spacing,
} from '@coachos/ui';
import { adherenceState, formatRelativeToNow, type AdherenceState } from '@coachos/utils';
import { ChevronRight } from 'lucide-react-native';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import type { CoachDashboardClient } from '../hooks/useCoachDashboard.ts';

// One client, one row — §8.2's exact field list: avatar, name, two 7-day
// adherence dots (training and nutrition, separately), last-activity text,
// unread badge. Nothing else earns a place at a hundred rows.

const NAME_LINE = fontSize.label[1].lineHeight; // '20px'
const META_LINE = fontSize.micro[1].lineHeight; // '15px'
const VERTICAL_PADDING = spacing(11);
const NAME_META_GAP = spacing(3);
/** 1, not `hairlineWidth`: the prototype's row rule is a 1px line, and a
 *  half-pixel divider would make the measured height below platform-dependent. */
const DIVIDER = 1;

function px(value: string): number {
  return Number.parseInt(value, 10);
}

/**
 * **The measured row height, and the row's own `minHeight`.**
 *
 * FlashList v2 has no `estimatedItemSize` — the prop was removed with v2's
 * recycler rewrite, which measures rows itself. So this number is applied
 * to the row rather than handed to the list, and that is what `CLAUDE.md`
 * §25.8 is really asking for: every row reports a stable, uniform size on
 * first layout instead of settling over several frames.
 *
 * Derived, not guessed:
 *
 * ```
 *   11  paddingTop
 * + 20  name        — `label`, lineHeight 20
 * +  3  gap
 * + 15  meta        — `micro`, lineHeight 15
 * + 11  paddingBottom
 * +  1  divider
 * = 61
 * ```
 *
 * The 32px avatar (`sm`) and the 34px dot lane (two 15px pairs + a 4px gap)
 * both sit inside the 38px text block, so neither sets the height. Read
 * from `fontSize` rather than written as a literal, so a change to the type
 * scale moves this number with it instead of silently invalidating it.
 *
 * `micro`, not the prototype's 12px: `ProgramTemplatesScreen`'s row meta
 * is already `micro`/`muted`, and two coach list rows disagreeing by a
 * pixel is worse than either number.
 *
 * At 200% text the row grows past this — which is why it is an *estimate*
 * and why nothing here pins a fixed `height` (`accessibility` §3).
 */
export const CLIENT_ROW_HEIGHT =
  VERTICAL_PADDING * 2 + px(NAME_LINE) + NAME_META_GAP + px(META_LINE) + DIVIDER;

const DOT_LANE_WIDTH = 26;

export interface ClientRowProps {
  client: CoachDashboardClient;
  /** Takes the id, never a closure over the row — a new arrow per row defeats `memo`. */
  onPress: (clientId: string) => void;
  testID?: string;
}

/**
 * `React.memo` because this renders a hundred times and re-renders whenever
 * a sibling counter changes (`frontend-performance` §3).
 */
export const ClientRow = memo(function ClientRow({ client, onPress, testID }: ClientRowProps) {
  const themed = useThemedStyles();
  const chevronColor = useChevronColor();

  const training = adherenceState(client.trainingAdherence);
  const nutrition = adherenceState(client.nutritionAdherence);
  const meta = buildMeta(client);

  return (
    <Pressable
      onPress={() => {
        onPress(client.clientId);
      }}
      accessibilityRole="button"
      // One sentence per client, not six fragments: a coach scrolling a
      // hundred rows with VoiceOver hears a hundred sentences, and the two
      // dot states arrive as WORDS — which is also what makes the row
      // readable with no colour vision at all (`accessibility` §2, §4).
      accessibilityLabel={buildRowLabel(
        client.name,
        training,
        nutrition,
        meta,
        client.unreadMessages,
      )}
      style={[styles.row, themed.divider]}
      testID={testID ?? `client-row-${client.clientId}`}
    >
      {/* Hidden from the reading order — the row's own label already says
          both states in words, and six focusable fragments per row is the
          failure `AdherenceDot`'s own contract warns about. */}
      <View
        style={styles.lane}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <MetricDot letter="T" state={training} />
        <MetricDot letter="N" state={nutrition} />
      </View>

      <Avatar name={client.name} userId={client.clientId} size="sm" />

      <View style={styles.text}>
        <Text size="label" numberOfLines={1}>
          {client.name}
        </Text>
        <Text size="micro" tone="muted" numberOfLines={1} style={styles.meta}>
          {meta}
        </Text>
      </View>

      {client.unreadMessages > 0 ? <Badge count={client.unreadMessages} tone="brand" /> : null}

      <ChevronRight size={15} color={chevronColor} />
    </Pressable>
  );
});

interface MetricDotProps {
  /** `T` or `N`. The second non-colour channel for WHICH metric, beside the dot's own for which state. */
  letter: string;
  state: AdherenceState;
}

function MetricDot({ letter, state }: MetricDotProps) {
  return (
    <View style={styles.pair}>
      <Text size="micro" tone="muted" style={styles.letter}>
        {letter}
      </Text>
      <AdherenceDot state={state} size="sm" />
    </View>
  );
}

/**
 * "4 of 5 sessions · active 2 hours ago" — facts only, never a judgement
 * (`product-copy` §1). Loss framing ("2 missed") is the same fact worded as
 * an accusation, and the coach app has no more licence to shame than the
 * client app does when the words could be read aloud to a client.
 */
function buildMeta(client: CoachDashboardClient): string {
  const sessions =
    client.sessionsScheduled7d > 0
      ? `${String(client.sessionsCompleted7d)} of ${String(client.sessionsScheduled7d)} sessions`
      : 'No sessions scheduled';

  const activity =
    client.lastActiveAt === null
      ? 'not active yet'
      : `active ${formatRelativeToNow(client.lastActiveAt)}`;

  return `${sessions} · ${activity}`;
}

function buildRowLabel(
  name: string,
  training: AdherenceState,
  nutrition: AdherenceState,
  meta: string,
  unread: number,
): string {
  const adherence = `Training ${ADHERENCE_STATE_LABEL[training].toLowerCase()}, nutrition ${ADHERENCE_STATE_LABEL[nutrition].toLowerCase()}`;
  const spoken = meta.replaceAll(' · ', ', ');
  const messages =
    unread === 0 ? '' : ` ${String(unread)} unread ${unread === 1 ? 'message' : 'messages'}.`;

  return `${name}. ${adherence}. ${spoken}.${messages}`;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(11),
    // `minHeight` and padding, never `height` — at 200% text the name and
    // meta lines grow and a fixed row would clip both.
    minHeight: CLIENT_ROW_HEIGHT,
    paddingVertical: VERTICAL_PADDING,
    borderBottomWidth: DIVIDER,
  },
  // `minWidth` on both, so the lane and the letters still line up at the
  // default scale and grow rather than clip at 200% (`accessibility` §3).
  lane: { minWidth: DOT_LANE_WIDTH, gap: spacing(4) },
  pair: { flexDirection: 'row', alignItems: 'center', gap: spacing(5) },
  letter: { minWidth: 8, textAlign: 'center' },
  text: { flex: 1, minWidth: 0 },
  meta: { marginTop: NAME_META_GAP },
});

const useThemedStyles = createThemedStyles((t) => ({
  divider: { borderBottomColor: t.colors.border.soft },
}));

// `fg.faint` never carries meaning (`DESIGN.md` §13) — the chevron says
// "this opens", which the row's `button` role already says out loud.
const useChevronColor = createThemedValue((t) => t.colors.fg.faint);
