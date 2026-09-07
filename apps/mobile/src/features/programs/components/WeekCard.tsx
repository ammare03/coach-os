import {
  Card,
  createThemedStyles,
  density,
  IconButton,
  Pressable,
  radius,
  spacing,
  Text,
  useTheme,
} from '@coachos/ui';
import { ChevronDown, ChevronRight, EllipsisVertical, Plus } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import type { ProgramDay, ProgramWeek } from '../api/programs.ts';
import { dayFullLabel, dayMetaLine, dayPillLabel, weekMetaLine } from '../program-days.ts';

// One L2 card per week (`program-builder/01`, frame 1a). **The card IS the
// week**: collapsing one never reflows the page, because a week owns its
// own surface rather than sharing a flat list with its neighbours. A
// twelve-week program stays navigable with a thumb because of this and
// nothing else.

export interface WeekCardProps {
  week: ProgramWeek;
  isExpanded: boolean;
  onToggle: () => void;
  onOpenDay: (programDayId: string) => void;
  onAddDay: () => void;
  /**
   * The week header's kebab — duplicate and delete (`program-builder/06`,
   * frame 1g). Optional, and the affordance is absent rather than inert
   * when it is not passed: a menu button that opens nothing reads as broken
   * (`ui-conventions` §4).
   */
  onWeekMenu?: (() => void) | undefined;
  /**
   * The same menu, scoped to one day. Frame 1g's three items — copy this
   * day, copy the week it is in, delete it — are about a DAY, so a day row
   * is where they hang from; the week header's kebab carries the week's own
   * two. Absent when not passed, for the reason above.
   */
  onDayMenu?: ((day: ProgramDay) => void) | undefined;
  testID?: string;
}

const HEADER_HEIGHT = 52;
const PILL_WIDTH = 40;
const PILL_HEIGHT = 30;

export function WeekCard({
  week,
  isExpanded,
  onToggle,
  onOpenDay,
  onAddDay,
  onWeekMenu,
  onDayMenu,
  testID,
}: WeekCardProps) {
  const theme = useTheme();
  const themed = useThemedStyles();
  const meta = weekMetaLine(week.days);

  return (
    <Card elevation="raised" density="coach" {...(testID ? { testID } : {})}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={`Week ${week.weekNumber}`}
        accessibilityHint={meta}
        accessibilityState={{ expanded: isExpanded }}
        style={[styles.header, isExpanded ? themed.divider : null]}
        testID={`week-header-${week.weekNumber}`}
      >
        {isExpanded ? (
          <ChevronDown size={15} color={theme.colors.brand.DEFAULT} />
        ) : (
          <ChevronRight size={15} color={theme.colors.fg.muted} />
        )}
        <View style={styles.grow}>
          <Text size="label" numberOfLines={1}>
            {`Week ${week.weekNumber}`}
          </Text>
          <Text size="caption" tone="subtle" numberOfLines={1}>
            {meta}
          </Text>
        </View>
        {onWeekMenu ? (
          <IconButton
            icon={<EllipsisVertical size={16} color={theme.colors.fg.muted} />}
            variant="ghost"
            size="sm"
            onPress={onWeekMenu}
            accessibilityLabel={`More actions for week ${week.weekNumber}`}
            testID={`week-menu-${week.weekNumber}`}
          />
        ) : null}
      </Pressable>

      {isExpanded ? (
        <>
          {week.days.map((day, index) => (
            <Pressable
              key={day.id}
              onPress={() => {
                onOpenDay(day.id);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${dayFullLabel(day.dayNumber)}, ${day.name}`}
              accessibilityHint={dayMetaLine(day)}
              style={[styles.dayRow, index < week.days.length - 1 ? themed.divider : null]}
              testID={`day-row-${day.id}`}
            >
              {/* A rest day is NEUTRAL, never red (`DESIGN.md` §10.5): the
                  absence of training is not a failure state. The pill loses
                  its fill and its warm ink and keeps its border — and the
                  meaning is carried by the row's name and meta too, never by
                  the colour alone (`accessibility` §4). */}
              <View
                style={[styles.pill, day.isRestDay ? themed.pillRest : themed.pillTraining]}
                importantForAccessibility="no"
              >
                <Text
                  size="micro"
                  tone={day.isRestDay ? 'muted' : 'warm'}
                  accessibilityElementsHidden
                  // The pill is a fixed 40x30 and "MON" cannot wrap inside
                  // it. Capped rather than clipped, exactly as `Avatar`'s
                  // initials are (`Text`'s own note on this prop): the row
                  // scales freely and its `accessibilityLabel` says
                  // "Monday" in full, so nothing is lost at 200%.
                  maxFontSizeMultiplier={1.3}
                >
                  {dayPillLabel(day.dayNumber)}
                </Text>
              </View>
              <View style={styles.grow}>
                <Text size="label" tone={day.isRestDay ? 'muted' : 'default'} numberOfLines={1}>
                  {day.name}
                </Text>
                <Text size="caption" tone="subtle" numberOfLines={1}>
                  {dayMetaLine(day)}
                </Text>
              </View>
              {/* The kebab sits BESIDE the chevron rather than replacing
                  it: the row still opens the day, and losing that affordance
                  to gain a menu would trade the common action for the rare
                  one. Two targets, each its own ≥44px (`IconButton`'s own
                  hit slop), so a thumb cannot hit the wrong one. */}
              {onDayMenu ? (
                <IconButton
                  icon={<EllipsisVertical size={16} color={theme.colors.fg.muted} />}
                  variant="ghost"
                  size="sm"
                  onPress={() => {
                    onDayMenu(day);
                  }}
                  accessibilityLabel={`More actions for ${day.name}`}
                  testID={`day-menu-${day.id}`}
                />
              ) : null}
              <ChevronRight size={15} color={theme.colors.fg.faint} />
            </Pressable>
          ))}

          <Pressable
            onPress={onAddDay}
            accessibilityRole="button"
            accessibilityLabel={`Add a day to week ${week.weekNumber}`}
            style={[styles.addRow, themed.ghostBorder]}
            testID={`add-day-${week.weekNumber}`}
          >
            <Plus size={15} color={theme.colors.brand.DEFAULT} />
            <Text size="body-sm" tone="warm">
              Add day
            </Text>
          </Pressable>
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  header: {
    minHeight: HEADER_HEIGHT,
    paddingHorizontal: spacing(14),
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(12),
  },
  dayRow: {
    minHeight: density.coach.row,
    paddingHorizontal: spacing(14),
    paddingVertical: spacing(9),
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(12),
  },
  pill: {
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    borderRadius: radius.chip,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addRow: {
    minHeight: 44,
    marginHorizontal: spacing(14),
    marginTop: spacing(6),
    marginBottom: spacing(12),
    borderRadius: radius.full,
    borderWidth: 1,
    borderStyle: 'dashed',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(8),
  },
});

const useThemedStyles = createThemedStyles((t) => ({
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.border.soft },
  pillTraining: { backgroundColor: t.colors.bg.inset, borderColor: t.colors.border.strong },
  // Transparent fill, the soft border, and `fg.muted` ink. The prototype
  // pins the label at `fg.faint`, which lands at 2:1 against the card and
  // fails `accessibility` §4's 4.5:1 floor — `muted` (5.6:1) keeps the pill
  // visibly recessed against the training pill's warm ink without making
  // the weekday unreadable.
  pillRest: { backgroundColor: 'transparent', borderColor: t.colors.border.soft },
  ghostBorder: { borderColor: t.colors.border.strong },
}));
