import { MacroBar, ProgressRing, type ProgressRingSize } from '@coachos/ui';
import { View } from 'react-native';

import { GallerySection } from '../GallerySection.tsx';
import { Specimen } from '../Specimen.tsx';

const RING_SIZES: readonly ProgressRingSize[] = ['sm', 'md', 'lg'];

export function ProportionSection() {
  return (
    <GallerySection
      title="Proportion of a target"
      note="Neither may use the adherence palette — going over a calorie target never renders red."
    >
      <Specimen label="ProgressRing · every size, under target">
        {RING_SIZES.map((size) => (
          <ProgressRing
            key={size}
            value={128}
            target={180}
            unit="g"
            unitLabel="grams"
            label="protein"
            size={size}
          />
        ))}
      </Specimen>

      <Specimen label="ProgressRing · empty, part way, exactly at target">
        <ProgressRing value={0} target={180} unit="g" unitLabel="grams" label="protein" />
        <ProgressRing value={90} target={180} unit="g" unitLabel="grams" label="protein" />
        <ProgressRing value={180} target={180} unit="g" unitLabel="grams" label="protein" />
      </Specimen>

      <Specimen label="ProgressRing · over target (the second, inset arc)">
        <ProgressRing value={210} target={180} unit="g" unitLabel="grams" label="protein" />
        <ProgressRing value={400} target={180} unit="g" unitLabel="grams" label="protein" />
      </Specimen>

      <Specimen label="ProgressRing · no target, and forced indeterminate">
        <ProgressRing value={128} target={null} unit="g" unitLabel="grams" label="protein" />
        <ProgressRing
          value={128}
          target={180}
          unit="g"
          unitLabel="grams"
          label="protein"
          isIndeterminate
        />
      </Specimen>

      <Specimen label="MacroBar · with a target, both densities" layout="column">
        <View className="gap-16">
          <MacroBar proteinG={148} carbsG={210} fatG={62} targetKcal={2200} density="client" />
          <MacroBar proteinG={148} carbsG={210} fatG={62} targetKcal={2200} density="coach" />
        </View>
      </Specimen>

      <Specimen label="MacroBar · under, over, and no target at all" layout="column">
        <View className="gap-16">
          <MacroBar proteinG={60} carbsG={80} fatG={20} targetKcal={2200} />
          <MacroBar proteinG={220} carbsG={330} fatG={110} targetKcal={2200} />
          <MacroBar proteinG={148} carbsG={210} fatG={62} />
          <MacroBar proteinG={148} carbsG={210} fatG={62} targetKcal={null} />
        </View>
      </Specimen>

      <Specimen label="MacroBar · hideLabels, and a day with nothing logged" layout="column">
        <View className="gap-16">
          <MacroBar proteinG={148} carbsG={210} fatG={62} targetKcal={2200} hideLabels />
          <MacroBar proteinG={0} carbsG={0} fatG={0} targetKcal={2200} />
        </View>
      </Specimen>
    </GallerySection>
  );
}
