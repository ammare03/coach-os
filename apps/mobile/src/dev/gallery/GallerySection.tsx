import { Divider, Text } from '@coachos/ui';
import type { ReactNode } from 'react';
import { View } from 'react-native';

export interface GallerySectionProps {
  title: string;
  /** What the section is for, in one line — the barrel comment's point, not a description of the code. */
  note?: string;
  children: ReactNode;
}

/**
 * One category of primitives, mirroring the section comments in
 * `packages/ui/src/index.ts` so the gallery and the barrel stay in step.
 */
export function GallerySection({ title, note, children }: GallerySectionProps) {
  return (
    <View className="gap-16 px-20 py-24">
      <View className="gap-4">
        <Text size="h2">{title}</Text>
        {note ? (
          <Text size="body-sm" tone="muted">
            {note}
          </Text>
        ) : null}
      </View>
      <Divider />
      <View className="gap-20">{children}</View>
    </View>
  );
}
