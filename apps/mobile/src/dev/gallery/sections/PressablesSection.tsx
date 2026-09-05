import {
  Button,
  IconButton,
  Pressable,
  Text,
  colors,
  type ButtonSize,
  type ButtonVariant,
  type IconButtonSize,
} from '@coachos/ui';
import { Check, Pause, Play, Trash2 } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { GallerySection } from '../GallerySection.tsx';
import { Specimen } from '../Specimen.tsx';

const VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger'];
const BUTTON_SIZES: readonly ButtonSize[] = ['sm', 'md', 'lg'];
const ICON_SIZES: readonly IconButtonSize[] = ['sm', 'md', 'lg'];
const ICON_PX = 18;

function noop() {
  // Specimens are inert: the gallery proves a component renders and reacts
  // to a press, never that a screen's mutation works.
}

export function PressablesSection() {
  return (
    <GallerySection
      title="Pressables"
      note="Button, IconButton, and the shared press treatment underneath both."
    >
      {VARIANTS.map((variant) => (
        <Specimen key={variant} label={`Button · variant="${variant}" · every size`}>
          {BUTTON_SIZES.map((size) => (
            <Button key={size} variant={variant} size={size} onPress={noop}>
              Log set
            </Button>
          ))}
        </Specimen>
      ))}

      <Specimen label="Button · disabled, every variant">
        {VARIANTS.map((variant) => (
          <Button key={variant} variant={variant} disabled onPress={noop}>
            Log set
          </Button>
        ))}
      </Specimen>

      <Specimen label="Button · loading (label swapped, width held)">
        {VARIANTS.map((variant) => (
          <Button key={variant} variant={variant} loading onPress={noop}>
            Log set
          </Button>
        ))}
      </Specimen>

      <Specimen label="Button · iconLeft, iconRight">
        <Button iconLeft={<Check size={ICON_PX} color={colors.fg.onBrand} />} onPress={noop}>
          Complete
        </Button>
        <Button
          variant="secondary"
          iconRight={<Play size={ICON_PX} color={colors.fg.DEFAULT} />}
          onPress={noop}
        >
          Start
        </Button>
      </Specimen>

      <Specimen label='Button · fullWidth, density="coach" then "client"' layout="column">
        <Button fullWidth density="coach" onPress={noop}>
          Coach density
        </Button>
        <Button fullWidth density="client" onPress={noop}>
          Client density
        </Button>
      </Specimen>

      {VARIANTS.map((variant) => (
        <Specimen key={variant} label={`IconButton · variant="${variant}" · every size`}>
          {ICON_SIZES.map((size) => (
            <IconButton
              key={size}
              variant={variant}
              size={size}
              icon={<Pause size={ICON_PX} color={colors.fg.DEFAULT} />}
              accessibilityLabel={`Pause, ${variant}, ${size}`}
              onPress={noop}
            />
          ))}
        </Specimen>
      ))}

      <Specimen label="IconButton · disabled">
        <IconButton
          variant="secondary"
          disabled
          icon={<Trash2 size={ICON_PX} color={colors.fg.faint} />}
          accessibilityLabel="Delete, disabled"
          onPress={noop}
        />
      </Specimen>

      <Specimen label="Pressable · default scale (.97), stepper scale (.92), disabled">
        <Pressable accessibilityLabel="Default press scale" onPress={noop}>
          <PressTile>.97</PressTile>
        </Pressable>
        <Pressable pressScale={0.92} accessibilityLabel="Stepper press scale" onPress={noop}>
          <PressTile>.92</PressTile>
        </Pressable>
        <Pressable disabled accessibilityLabel="Disabled" onPress={noop}>
          <PressTile>off</PressTile>
        </Pressable>
      </Specimen>

      <Specimen label="Pressable · render-prop child (reads its own pressed state)">
        <Pressable accessibilityLabel="Render prop" onPress={noop}>
          {({ pressed }) => <PressTile>{pressed ? 'held' : 'idle'}</PressTile>}
        </Pressable>
      </Specimen>
    </GallerySection>
  );
}

/** A neutral surface to press — `Pressable` renders no chrome of its own. */
function PressTile({ children }: { children: ReactNode }) {
  return (
    <View className="h-52 w-64 items-center justify-center rounded-control border border-border bg-bg-raised">
      <Text size="label" tone="muted">
        {children}
      </Text>
    </View>
  );
}
