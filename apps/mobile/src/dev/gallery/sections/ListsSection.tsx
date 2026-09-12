import { Badge, ListRow, ListSection } from '@coachos/ui';
import { Download, Info, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { GallerySection } from '../GallerySection.tsx';
import { Specimen } from '../Specimen.tsx';

const NOOP = () => {};

export function ListsSection() {
  const [syncsHealth, setSyncsHealth] = useState(true);
  const [sharesUsage, setSharesUsage] = useState(false);

  return (
    <GallerySection
      title="Lists"
      note="One row shape for settings, the More hub, notification toggles, and the blocked list. Check it at 200% text: the label wraps and the row grows."
    >
      <Specimen label="ListRow · trailing chevron — the row navigates" layout="column">
        <ListSection title="Help and about">
          <ListRow label="Medical disclaimer" icon={Info} onPress={NOOP} />
          <ListRow
            label="Your data"
            description="Request a copy of everything you have logged"
            icon={Download}
            onPress={NOOP}
          />
        </ListSection>
      </Specimen>

      <Specimen label="ListRow · trailing value + chevron, and trailing none" layout="column">
        <ListSection title="Preferences">
          <ListRow label="Weight unit" trailing={{ kind: 'value', value: 'kg' }} onPress={NOOP} />
          <ListRow label="Appearance" trailing={{ kind: 'value', value: 'Dark' }} onPress={NOOP} />
          <ListRow label="App version" trailing={{ kind: 'value', value: '1.0.0 (24)' }} />
        </ListSection>
      </Specimen>

      <Specimen label="ListRow · trailing switch — the whole row is the target" layout="column">
        <ListSection title="Notifications">
          <ListRow
            label="Sync workouts to Apple Health"
            description="Completed sessions only. Nothing is read back."
            trailing={{ kind: 'switch', value: syncsHealth, onValueChange: setSyncsHealth }}
          />
          <ListRow
            label="Share usage data"
            trailing={{ kind: 'switch', value: sharesUsage, onValueChange: setSharesUsage }}
          />
        </ListSection>
      </Specimen>

      <Specimen label="ListRow · destructive and disabled" layout="column">
        <ListSection title="Your data">
          <ListRow label="Delete account" icon={Trash2} onPress={NOOP} destructive />
          <ListRow
            label="Light theme"
            description="Not available yet"
            trailing={{ kind: 'value', value: 'Dark' }}
            onPress={NOOP}
            disabled
          />
        </ListSection>
      </Specimen>

      <Specimen label="ListRow · custom trailing slot, and coach density" layout="column">
        <ListSection title="Privacy and safety" density="coach">
          <ListRow
            label="Blocked people"
            density="coach"
            onPress={NOOP}
            trailing={{ kind: 'custom', render: () => <Badge count={3} /> }}
          />
          <ListRow label="Privacy" density="coach" onPress={NOOP} />
        </ListSection>
      </Specimen>

      <Specimen label="ListSection · a section with no rows renders nothing" layout="column">
        <View className="gap-12">
          <ListSection title="Coaching">{null}</ListSection>
        </View>
      </Specimen>
    </GallerySection>
  );
}
