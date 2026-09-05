import {
  Avatar,
  AvatarStack,
  getAvatarFallback,
  getAvatarInitials,
  Text,
  type AvatarSize,
  type AvatarStackPerson,
} from '@coachos/ui';
import { View } from 'react-native';

import { GallerySection } from '../GallerySection.tsx';
import { Specimen } from '../Specimen.tsx';

const SIZES: readonly AvatarSize[] = ['xs', 'sm', 'md', 'lg'];

const PEOPLE: readonly AvatarStackPerson[] = [
  { userId: 'u1', name: 'Priya Nair' },
  { userId: 'u2', name: 'Marco Silva' },
  { userId: 'u3', name: 'Ada Okafor' },
  { userId: 'u4', name: 'Jonas Berg' },
  { userId: 'u5', name: 'Wei Chen' },
  { userId: 'u6', name: 'Sam' },
];

// A 1×1 PNG, inline, so the image branch renders with no network and no
// asset pipeline — the point is that `uri` takes the photo path at all.
const PIXEL_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export function PeopleSection() {
  return (
    <GallerySection
      title="People"
      note="The fallback is derived from the user id, so the same person is the same colour everywhere."
    >
      <Specimen label="Avatar · every size, initials fallback">
        {SIZES.map((size) => (
          <Avatar key={size} name="Priya Nair" userId="u1" size={size} />
        ))}
      </Specimen>

      <Specimen label="Avatar · one word, three words, and a single letter">
        <Avatar name="Sam" userId="u6" size="md" />
        <Avatar name="Ada Chidinma Okafor" userId="u3" size="md" />
        <Avatar name="X" userId="u7" size="md" />
      </Specimen>

      <Specimen label="Avatar · a photo, and a photo with an explicit recyclingKey">
        <Avatar name="Priya Nair" userId="u1" uri={PIXEL_URI} size="lg" />
        <Avatar name="Marco Silva" userId="u2" uri={PIXEL_URI} recyclingKey="row-2" size="lg" />
      </Specimen>

      <Specimen label="Avatar · presence, every size">
        {SIZES.map((size) => (
          <Avatar key={size} name="Priya Nair" userId="u1" size={size} presence="online" />
        ))}
        {SIZES.map((size) => (
          <Avatar
            key={`${size}-offline`}
            name="Marco Silva"
            userId="u2"
            size={size}
            presence="offline"
          />
        ))}
      </Specimen>

      <Specimen label="AvatarStack · under the cap, at it, and over it" layout="column">
        <View className="gap-16">
          <AvatarStack people={PEOPLE.slice(0, 3)} />
          <AvatarStack people={PEOPLE.slice(0, 4)} />
          <AvatarStack people={PEOPLE} />
          <AvatarStack people={PEOPLE} max={2} />
        </View>
      </Specimen>

      <Specimen label="AvatarStack · every size" layout="column">
        <View className="gap-16">
          {SIZES.map((size) => (
            <AvatarStack key={size} people={PEOPLE} size={size} />
          ))}
        </View>
      </Specimen>

      <Specimen label="getAvatarInitials / getAvatarFallback · the pure pair" layout="column">
        {PEOPLE.slice(0, 3).map((person) => (
          <Text key={person.userId} size="body-sm" tone="muted">
            {person.name} → {getAvatarInitials(person.name)} ·{' '}
            {getAvatarFallback(person.name, person.userId).gradient.join(' → ')}
          </Text>
        ))}
      </Specimen>
    </GallerySection>
  );
}
