import { Text } from '@coachos/ui';
import type { ReactNode } from 'react';
import { View } from 'react-native';

export interface SpecimenProps {
  /** The props under test, spelled out — `variant="primary" · size="lg"`, not "big button". */
  label: string;
  /** `row` wraps side by side (variant grids); `column` stacks (anything full-width). */
  layout?: 'row' | 'column';
  children: ReactNode;
}

/** One labelled cell of a section: the props being shown, and the render. */
export function Specimen({ label, layout = 'row', children }: SpecimenProps) {
  return (
    <View className="gap-8">
      <Text size="eyebrow" tone="subtle">
        {label}
      </Text>
      <View
        className={
          layout === 'row' ? 'flex-row flex-wrap items-center gap-12' : 'items-stretch gap-12'
        }
      >
        {children}
      </View>
    </View>
  );
}
