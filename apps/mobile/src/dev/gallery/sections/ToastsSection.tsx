import {
  Button,
  Toast,
  UNDO_WINDOW_MS,
  useToast,
  useUndoToast,
  TOAST_DEFAULT_DURATION_MS,
} from '@coachos/ui';
import { View } from 'react-native';

import { GallerySection } from '../GallerySection.tsx';
import { Specimen } from '../Specimen.tsx';

function noop() {
  // Inert specimen.
}

export function ToastsSection() {
  const { showToast } = useToast();
  const showUndoToast = useUndoToast();

  return (
    <GallerySection
      title="Toasts and undo"
      note="A destructive action performs immediately and offers five seconds back — it does not ask first."
    >
      <Specimen label="useToast · plain, with an action, and past the visible cap">
        <Button
          variant="secondary"
          size="sm"
          onPress={() => showToast({ message: 'Program published' })}
        >
          Plain
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onPress={() =>
            showToast({
              message: 'Draft saved',
              action: { label: 'View', onPress: noop },
              durationMs: TOAST_DEFAULT_DURATION_MS,
            })
          }
        >
          With action
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onPress={() => {
            for (let index = 1; index <= 5; index += 1) {
              showToast({ message: `Queued toast ${index}` });
            }
          }}
        >
          Queue five
        </Button>
      </Specimen>

      <Specimen label="useUndoToast · the five-second window, with a countdown">
        <Button
          variant="danger"
          size="sm"
          onPress={() =>
            showUndoToast({
              message: 'Set deleted',
              onUndo: noop,
              onCommit: noop,
              durationMs: UNDO_WINDOW_MS,
            })
          }
        >
          Delete a set
        </Button>
        <Button
          variant="danger"
          size="sm"
          onPress={() =>
            showUndoToast({ message: 'Meal removed', onUndo: noop, undoLabel: 'Put it back' })
          }
        >
          Custom undo label
        </Button>
      </Specimen>

      <Specimen label="Toast · rendered in place, every shape" layout="column">
        <View className="gap-12">
          <Toast
            toastId="gallery-plain"
            message="Program published"
            durationMs={TOAST_DEFAULT_DURATION_MS}
            onTimeout={noop}
          />
          <Toast
            toastId="gallery-action"
            message="Set deleted"
            action={{ label: 'Undo', onPress: noop }}
            durationMs={UNDO_WINDOW_MS}
            onTimeout={noop}
          />
          <Toast
            toastId="gallery-countdown"
            message="Set deleted"
            action={{ label: 'Undo', onPress: noop }}
            durationMs={UNDO_WINDOW_MS}
            showCountdown
            onTimeout={noop}
          />
          <Toast
            toastId="gallery-leaving"
            message="Meal removed"
            durationMs={UNDO_WINDOW_MS}
            isLeaving
            onTimeout={noop}
          />
        </View>
      </Specimen>
    </GallerySection>
  );
}
