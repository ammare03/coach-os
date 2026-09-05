import { StyleSheet, View } from 'react-native';

import { createThemedStyles } from '../theme/createThemedStyles.ts';
import { radius } from '../theme/tokens.ts';
import { useTheme } from '../theme/useTheme.ts';

import {
  Avatar,
  AVATAR_DIAMETER,
  AVATAR_MAX_FONT_SCALE,
  AVATAR_TEXT_SIZE,
  type AvatarSize,
} from './Avatar.tsx';
import { Metric } from './Metric.tsx';

export interface AvatarStackPerson {
  uri?: string;
  name: string;
  userId: string;
  blurhash?: string;
}

export interface AvatarStackProps {
  people: readonly AvatarStackPerson[];
  /** @default 4 */
  max?: number;
  size?: AvatarSize;
  testID?: string;
}

const RING_WIDTH = 2;
const OVERLAP_FRACTION = 0.3;

/**
 * Overlapping avatars with a `bg.DEFAULT` ring between them, then a `+n`
 * overflow chip — the only representation of who is in a group (a live
 * session's participant strip, a coach's client-group summary), so unlike
 * `Avatar` it carries ONE accessible label naming the visible members and
 * the overflow count (`ui-primitives-core/06`). Individual avatars stay
 * hidden from the screen reader; this wrapper is what gets focused.
 */
export function AvatarStack({ people, max = 4, size = 'sm', testID }: AvatarStackProps) {
  const { colors } = useTheme();
  const themed = useThemedStyles();

  if (people.length === 0) return null;

  const diameter = AVATAR_DIAMETER[size];
  const overlap = Math.round(diameter * OVERLAP_FRACTION);
  const visible = people.slice(0, max);
  const overflowCount = Math.max(0, people.length - max);
  const label = buildLabel(
    visible.map((person) => person.name),
    overflowCount,
  );

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={label}
      style={styles.row}
    >
      {visible.map((person, index) => (
        <View
          key={person.userId}
          style={[
            styles.ring,
            {
              width: diameter + RING_WIDTH * 2,
              height: diameter + RING_WIDTH * 2,
              borderRadius: radius.full,
              backgroundColor: colors.bg.DEFAULT,
              marginLeft: index === 0 ? 0 : -overlap,
              zIndex: visible.length - index,
            },
          ]}
        >
          <Avatar
            // `exactOptionalPropertyTypes` forbids passing `uri={undefined}`/
            // `blurhash={undefined}` explicitly, so each is only spread in
            // when the person actually has one.
            {...(person.uri ? { uri: person.uri } : {})}
            name={person.name}
            userId={person.userId}
            {...(person.blurhash ? { blurhash: person.blurhash } : {})}
            size={size}
          />
        </View>
      ))}
      {overflowCount > 0 ? (
        <View
          style={[
            styles.ring,
            {
              width: diameter + RING_WIDTH * 2,
              height: diameter + RING_WIDTH * 2,
              borderRadius: radius.full,
              backgroundColor: colors.bg.DEFAULT,
              marginLeft: -overlap,
              zIndex: 0,
            },
          ]}
        >
          <View
            style={[
              themed.overflowFill,
              { width: diameter, height: diameter, borderRadius: radius.full },
            ]}
          >
            {/* Capped for the same reason `Avatar`'s initials are: the chip is
                one of the circles in the stack and cannot grow past it.
                `default`, not `muted`: the chip's fill is `border.strong`,
                against which `fg.muted` measures 3.38:1 (dark) / 3.21:1
                (light), under SC 1.4.3 for a count that is the only place
                the hidden members are named at all. */}
            <Metric
              value={`+${overflowCount}`}
              size={AVATAR_TEXT_SIZE[size]}
              tone="default"
              maxFontSizeMultiplier={AVATAR_MAX_FONT_SCALE[size]}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function buildLabel(names: string[], overflowCount: number): string {
  const listed = names.join(', ');
  return overflowCount > 0 ? `${listed}, and ${overflowCount} more` : listed;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const useThemedStyles = createThemedStyles((theme) => ({
  overflowFill: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.border.strong,
    overflow: 'hidden',
  },
}));
