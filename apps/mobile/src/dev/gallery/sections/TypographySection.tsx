import { Metric, Text, type TextSize, type TextTone } from '@coachos/ui';
import { View } from 'react-native';

import { GallerySection } from '../GallerySection.tsx';
import { Specimen } from '../Specimen.tsx';

// `DESIGN.md` §1.2's closed scale, in the order `tokens.ts` declares it.
const SIZES: readonly TextSize[] = [
  'display',
  'numeral-xl',
  'stat',
  'h1-client',
  'h1',
  'h2',
  'title',
  'body-lg',
  'body',
  'body-sm',
  'numeral',
  'label',
  'caption',
  'micro',
  'eyebrow',
];

const TONES: readonly TextTone[] = [
  'bright',
  'default',
  'glass',
  'warm',
  'warm-muted',
  'muted',
  'subtle',
  'faint',
  'onBrand',
  'urgent',
];

// `Metric` narrows the ramp to five — `bright` is hero numerals only.
const METRIC_TONES = ['bright', 'default', 'warm', 'glass', 'muted'] as const;

export function TypographySection() {
  return (
    <GallerySection
      title="Text and Metric"
      note="Words go through Text, numbers through Metric — every size pins its own face and weight."
    >
      <Specimen label="Text · every size" layout="column">
        {SIZES.map((size) => (
          <View key={size} className="gap-3">
            <Text size="eyebrow" tone="faint">
              {size}
            </Text>
            <Text size={size}>Squat 3×5</Text>
          </View>
        ))}
      </Specimen>

      <Specimen label="Text · every tone, at body" layout="column">
        {TONES.map((tone) => (
          <Text key={tone} tone={tone}>
            {tone} — the warm text ramp
          </Text>
        ))}
      </Specimen>

      <Specimen label="Text · numberOfLines and wrapping">
        <View className="w-1/2">
          <Text numberOfLines={2}>
            A long label that has to wrap inside a fixed column, twice over.
          </Text>
        </View>
      </Specimen>

      <Specimen label="Metric · sizes, with and without a unit" layout="column">
        <Metric value={102.5} unit="kg" size="display" />
        <Metric value="12,450" unit="kg" size="numeral-xl" />
        <Metric value={82} unit="%" size="stat" />
        <Metric value="04:30" size="h1" />
        <Metric value={8} unit="reps" size="numeral" />
        <Metric value={3} size="caption" />
      </Specimen>

      <Specimen label="Metric · tones">
        {METRIC_TONES.map((tone) => (
          <Metric key={tone} value={72.5} unit="kg" size="stat" tone={tone} />
        ))}
      </Specimen>
    </GallerySection>
  );
}
