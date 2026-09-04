import { StyleSheet, View } from 'react-native';

import { colors, radius, type TextSize } from '../theme/tokens.ts';

import { Avatar, type AvatarSize } from './Avatar.tsx';
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

const DIAMETER: Record<AvatarSize, number> = { xs: 24, sm: 32, md: 48, lg: 72 };
const OVERFLOW_TEXT_SIZE: Record<AvatarSize, TextSize> = {
  xs: 'micro',
  sm: 'caption',
  md: 'label',
  lg: 'title',
};
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
  if (people.length === 0) return null;

  const diameter = DIAMETER[size];
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
              styles.overflowFill,
              { width: diameter, height: diameter, borderRadius: radius.full },
            ]}
          >
            <Metric value={`+${overflowCount}`} size={OVERFLOW_TEXT_SIZE[size]} tone="muted" />
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
  overflowFill: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.border.strong,
    overflow: 'hidden',
  },
});
