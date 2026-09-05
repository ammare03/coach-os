import {
  Card,
  Skeleton,
  SkeletonCircle,
  SkeletonText,
  type SkeletonRadius,
  type TextSize,
} from '@coachos/ui';
import { View } from 'react-native';

import { GallerySection } from '../GallerySection.tsx';
import { Specimen } from '../Specimen.tsx';

const RADII: readonly SkeletonRadius[] = [
  'cell',
  'chip',
  'control',
  'card',
  'section',
  'sheet',
  'full',
];

const TEXT_SIZES: readonly TextSize[] = ['stat', 'h2', 'title', 'body', 'body-sm', 'caption'];

export function LoadingSection() {
  return (
    <GallerySection
      title="Loading"
      note="A skeleton is shaped like the content it stands in for, so nothing shifts when the data lands."
    >
      <Specimen label="Skeleton · every radius on the ladder" layout="column">
        <View className="gap-12">
          {RADII.map((radiusName) => (
            <Skeleton key={radiusName} height={32} radius={radiusName} />
          ))}
        </View>
      </Specimen>

      <Specimen label="Skeleton · an explicit width, and one filling its parent">
        <Skeleton width={80} height={20} />
        <Skeleton width="50%" height={20} />
      </Specimen>

      <Specimen label="Skeleton · one accessibilityLabel per region, not per shape" layout="column">
        <Card elevation="raised" density="coach">
          <View className="gap-8">
            <Skeleton height={20} accessibilityLabel="Loading this week" />
            <Skeleton height={20} />
            <Skeleton height={20} />
          </View>
        </Card>
      </Specimen>

      <Specimen
        label="SkeletonText · reserves the line box of the size it replaces"
        layout="column"
      >
        <View className="gap-16">
          {TEXT_SIZES.map((size) => (
            <SkeletonText key={size} size={size} />
          ))}
        </View>
      </Specimen>

      <Specimen label="SkeletonText · multiple lines, and a ragged last line" layout="column">
        <View className="gap-16">
          <SkeletonText lines={3} />
          <SkeletonText lines={4} lastLineWidth="40%" />
          <SkeletonText size="body-sm" lines={2} lastLineWidth={120} />
        </View>
      </Specimen>

      <Specimen label="SkeletonCircle · list-row default, and an Avatar's diameter">
        <SkeletonCircle />
        <SkeletonCircle diameter={24} />
        <SkeletonCircle diameter={40} />
        <SkeletonCircle diameter={64} accessibilityLabel="Loading photo" />
      </Specimen>
    </GallerySection>
  );
}
