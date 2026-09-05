import {
  Button,
  hapticSessionComplete,
  hapticSetLogged,
  hapticValidationFailure,
} from '@coachos/ui';

import { GallerySection } from '../GallerySection.tsx';
import { Specimen } from '../Specimen.tsx';

export function HapticsSection() {
  return (
    <GallerySection
      title="Haptics"
      note="Three, named for their use case. There is deliberately no generic triggerHaptic."
    >
      <Specimen label="The only three haptics in the product">
        <Button variant="secondary" size="sm" onPress={hapticSetLogged}>
          Set logged
        </Button>
        <Button variant="secondary" size="sm" onPress={hapticSessionComplete}>
          Session complete
        </Button>
        <Button variant="secondary" size="sm" onPress={hapticValidationFailure}>
          Validation failed
        </Button>
      </Specimen>
    </GallerySection>
  );
}
