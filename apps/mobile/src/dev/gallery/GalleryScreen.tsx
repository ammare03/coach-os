import {
  Divider,
  SegmentedControl,
  Text,
  TextScaleProvider,
  ThemeProvider,
  ToastProvider,
  type Scheme,
} from '@coachos/ui';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SectionBoundary } from './SectionBoundary.tsx';
import { GALLERY_SECTIONS } from './sections/registry.ts';

const SCHEMES = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
] as const;

// `accessibility` §3 asks for 200%; 150% is on the way there and is where
// two-column layouts collide before anything actually clips.
const SCALES = [
  { value: '1', label: '100%' },
  { value: '1.5', label: '150%' },
  { value: '2', label: '200%' },
] as const;

type ScaleValue = (typeof SCALES)[number]['value'];

const BOTTOM_PADDING = 64;

/**
 * Every `packages/ui` primitive, every documented variant, on one screen —
 * so the first time two of them are seen side by side is here and not in a
 * feature screen, where a visual inconsistency is far more expensive.
 *
 * The two toggles sit OUTSIDE the theme and scale they control: a toolbar
 * that reflows at 200% is a toolbar you cannot use to get back to 100%.
 */
export function GalleryScreen() {
  const [scheme, setScheme] = useState<Scheme>('dark');
  const [scale, setScale] = useState<ScaleValue>('1');
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-bg-outer" style={{ paddingTop: insets.top }}>
      <View className="gap-12 px-20 py-16">
        <Text size="eyebrow" tone="subtle">
          Component gallery · dev only
        </Text>
        <SegmentedControl options={SCHEMES} value={scheme} onChange={setScheme} />
        <SegmentedControl options={SCALES} value={scale} onChange={setScale} />
      </View>
      <Divider />

      <ThemeProvider scheme={scheme}>
        <TextScaleProvider scale={Number(scale)}>
          <ToastProvider>
            <ScrollView
              className="flex-1 bg-bg"
              contentContainerStyle={{ paddingBottom: insets.bottom + BOTTOM_PADDING }}
            >
              {GALLERY_SECTIONS.map(({ name, Section }) => (
                <SectionBoundary key={name} name={name}>
                  <Section />
                </SectionBoundary>
              ))}
            </ScrollView>
          </ToastProvider>
        </TextScaleProvider>
      </ThemeProvider>
    </View>
  );
}
