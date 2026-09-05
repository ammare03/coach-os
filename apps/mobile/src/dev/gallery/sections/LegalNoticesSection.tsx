import { MedicalDisclaimer } from '@coachos/ui';
import { View } from 'react-native';

import { GallerySection } from '../GallerySection.tsx';
import { Specimen } from '../Specimen.tsx';

function noop() {
  // Inert specimen.
}

export function LegalNoticesSection() {
  return (
    <GallerySection
      title="Legal notices"
      note="Placeholder copy pending legal review (CLAUDE.md §21.3). The onboarding variant's Continue is disabled until the acknowledgment is given; the settings variant asks for nothing."
    >
      <Specimen
        label="MedicalDisclaimer · onboarding (tap the row to enable Continue)"
        layout="column"
      >
        <MedicalDisclaimer variant="onboarding" onAcknowledge={noop} />
      </Specimen>

      <Specimen label="MedicalDisclaimer · settings, acknowledged and not" layout="column">
        <View className="gap-16">
          <MedicalDisclaimer variant="settings" acknowledgedOn="16 Aug 2026" />
          <MedicalDisclaimer variant="settings" />
        </View>
      </Specimen>

      <Specimen label="MedicalDisclaimer · coach density" layout="column">
        <MedicalDisclaimer variant="settings" density="coach" acknowledgedOn="16 Aug 2026" />
      </Specimen>
    </GallerySection>
  );
}
