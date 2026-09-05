import { Badge, Chip, SegmentedControl, Text, colors } from '@coachos/ui';
import { Filter } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { GallerySection } from '../GallerySection.tsx';
import { Specimen } from '../Specimen.tsx';

const TWO = [
  { value: 'training', label: 'Training' },
  { value: 'nutrition', label: 'Nutrition' },
] as const;

const THREE = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'all', label: 'All' },
] as const;

const FOUR = [
  { value: 'mon', label: 'Mon' },
  { value: 'tue', label: 'Tue' },
  { value: 'wed', label: 'Wed' },
  { value: 'thu', label: 'Thu' },
] as const;

function noop() {
  // Inert specimen.
}

export function LabelsSection() {
  const [two, setTwo] = useState<(typeof TWO)[number]['value']>('training');
  const [three, setThree] = useState<(typeof THREE)[number]['value']>('week');
  const [four, setFour] = useState<(typeof FOUR)[number]['value']>('tue');
  const [selectedChips, setSelectedChips] = useState<readonly string[]>(['Push']);

  const toggleChip = (label: string) =>
    setSelectedChips((current) =>
      current.includes(label) ? current.filter((item) => item !== label) : [...current, label],
    );

  return (
    <GallerySection
      title="Chips, badges, segmented control"
      note="A badge is never interactive and never red — position carries 'notification', not colour."
    >
      <Specimen label="Chip · unselected, selected, with an icon">
        {['Push', 'Pull', 'Legs'].map((label) => (
          <Chip
            key={label}
            label={label}
            selected={selectedChips.includes(label)}
            onPress={() => toggleChip(label)}
          />
        ))}
        <Chip
          label="Filters"
          iconLeft={<Filter size={14} color={colors.fg.muted} />}
          onPress={noop}
        />
      </Specimen>

      <Specimen label="Chip · removable (a second, separate 44px target)">
        <Chip label="Barbell" onRemove={noop} />
        <Chip label="Barbell" selected onPress={noop} onRemove={noop} />
        <Chip label="Read only" />
      </Specimen>

      <Specimen label="Badge · counts, both sizes, both tones">
        <Badge count={3} size="sm" />
        <Badge count={3} size="md" />
        <Badge count={3} size="sm" tone="brand" />
        <Badge count={12} size="md" tone="brand" />
        <Badge count={128} size="md" tone="brand" />
      </Specimen>

      <Specimen label="Badge · label, and the bare dot (neither count nor label)">
        <Badge label="New" size="sm" />
        <Badge label="Live" size="md" tone="brand" />
        <Badge size="sm" />
        <Badge size="md" tone="brand" />
      </Specimen>

      <Specimen label="SegmentedControl · two, three, four options" layout="column">
        <View className="gap-12">
          <SegmentedControl options={TWO} value={two} onChange={setTwo} />
          <SegmentedControl options={THREE} value={three} onChange={setThree} />
          <SegmentedControl options={FOUR} value={four} onChange={setFour} />
          <SegmentedControl options={THREE} value={three} onChange={setThree} density="coach" />
        </View>
      </Specimen>

      <Specimen label="Badge · on a row, where position says 'notification'">
        <View className="flex-row items-center gap-8">
          <Text size="label">Messages</Text>
          <Badge count={4} size="sm" tone="brand" />
        </View>
      </Specimen>
    </GallerySection>
  );
}
