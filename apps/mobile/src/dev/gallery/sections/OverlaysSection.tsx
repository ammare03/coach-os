import {
  Button,
  Card,
  ConfirmModal,
  Modal,
  Sheet,
  SheetFooter,
  SheetHeader,
  Text,
  type SheetSnap,
} from '@coachos/ui';
import { useState } from 'react';
import { View } from 'react-native';

import { GallerySection } from '../GallerySection.tsx';
import { Specimen } from '../Specimen.tsx';

const SNAPS: readonly SheetSnap[] = ['auto', 'half', 'full'];

type Overlay =
  | { kind: 'none' }
  | { kind: 'sheet'; snap: SheetSnap; isDismissible: boolean }
  | { kind: 'modal'; isDismissible: boolean }
  | { kind: 'confirm' };

const CLOSED: Overlay = { kind: 'none' };

export function OverlaysSection() {
  const [overlay, setOverlay] = useState<Overlay>(CLOSED);
  const close = () => setOverlay(CLOSED);

  return (
    <GallerySection
      title="Overlays"
      note="A sheet is for doing something; a modal is for stopping something."
    >
      <Specimen label="Sheet · every snap point">
        {SNAPS.map((snap) => (
          <Button
            key={snap}
            variant="secondary"
            size="sm"
            onPress={() => setOverlay({ kind: 'sheet', snap, isDismissible: true })}
          >
            {snap}
          </Button>
        ))}
      </Specimen>

      <Specimen label="Sheet · isDismissible={false} (backdrop, drag, and Android back all blocked)">
        <Button
          variant="secondary"
          size="sm"
          onPress={() => setOverlay({ kind: 'sheet', snap: 'auto', isDismissible: false })}
        >
          Open trapped sheet
        </Button>
      </Specimen>

      <Specimen label="Modal · dismissible, then not">
        <Button
          variant="secondary"
          size="sm"
          onPress={() => setOverlay({ kind: 'modal', isDismissible: true })}
        >
          Open modal
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onPress={() => setOverlay({ kind: 'modal', isDismissible: false })}
        >
          Open blocking modal
        </Button>
      </Specimen>

      <Specimen label="ConfirmModal · typed confirmation (deletion and archival only)">
        <Button variant="danger" size="sm" onPress={() => setOverlay({ kind: 'confirm' })}>
          Delete account
        </Button>
      </Specimen>

      <Sheet
        isOpen={overlay.kind === 'sheet'}
        onDismiss={close}
        snap={overlay.kind === 'sheet' ? overlay.snap : 'auto'}
        isDismissible={overlay.kind === 'sheet' ? overlay.isDismissible : true}
      >
        <SheetHeader title="Add to Tuesday" subtitle="Lower body · week 3" onClose={close} />
        <View className="gap-12 px-20 py-16">
          <Card elevation="inset" density="client">
            <Text size="body-sm" tone="muted">
              Sheet body. `SheetHeader` above, `SheetFooter` below — both are separate components so
              a sheet can have either, both, or neither.
            </Text>
          </Card>
          <SheetFooter actionLabel="Add 2 exercises" onAction={close} isActionDisabled={false} />
          <SheetFooter actionLabel="Add 2 exercises" onAction={close} />
          <SheetFooter actionLabel="Add 2 exercises" onAction={close} isActionLoading />
        </View>
      </Sheet>

      <Modal
        isOpen={overlay.kind === 'modal'}
        onDismiss={close}
        isDismissible={overlay.kind === 'modal' ? overlay.isDismissible : true}
      >
        <View className="gap-16">
          <Text size="title">Stop and read this</Text>
          <Text size="body-sm" tone="muted">
            A modal interrupts. It gets one job and one way out.
          </Text>
          <Button onPress={close}>Got it</Button>
        </View>
      </Modal>

      <ConfirmModal
        isOpen={overlay.kind === 'confirm'}
        onCancel={close}
        onConfirm={close}
        title="Delete your account"
        body="Your data is removed after a 7-day grace period. Type DELETE to confirm."
        confirmationText="DELETE"
        actionLabel="Delete account"
      />
    </GallerySection>
  );
}
