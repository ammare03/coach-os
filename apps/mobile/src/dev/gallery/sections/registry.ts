import type { ComponentType } from 'react';

import { AdherenceSection } from './AdherenceSection.tsx';
import { ChartsSection } from './ChartsSection.tsx';
import { DatesSection } from './DatesSection.tsx';
import { FormsSection } from './FormsSection.tsx';
import { HapticsSection } from './HapticsSection.tsx';
import { LabelsSection } from './LabelsSection.tsx';
import { LoadingSection } from './LoadingSection.tsx';
import { OverlaysSection } from './OverlaysSection.tsx';
import { PeopleSection } from './PeopleSection.tsx';
import { PressablesSection } from './PressablesSection.tsx';
import { ProportionSection } from './ProportionSection.tsx';
import { ScreenStatesSection } from './ScreenStatesSection.tsx';
import { SurfacesSection } from './SurfacesSection.tsx';
import { ToastsSection } from './ToastsSection.tsx';
import { TypographySection } from './TypographySection.tsx';

export interface GalleryEntry {
  /** Matches a section comment in `packages/ui/src/index.ts` — the two stay in step. */
  name: string;
  Section: ComponentType;
}

// Declaration order is render order, and it follows the barrel's own order so
// a primitive added to `packages/ui` has one obvious place to land here.
export const GALLERY_SECTIONS: readonly GalleryEntry[] = [
  { name: 'Text and Metric', Section: TypographySection },
  { name: 'Pressables', Section: PressablesSection },
  { name: 'Surfaces', Section: SurfacesSection },
  { name: 'Forms', Section: FormsSection },
  { name: 'Overlays', Section: OverlaysSection },
  { name: 'Toasts and undo', Section: ToastsSection },
  { name: 'Chips, badges, segmented control', Section: LabelsSection },
  { name: 'Calendar', Section: DatesSection },
  { name: 'Proportion of a target', Section: ProportionSection },
  { name: 'A line over time', Section: ChartsSection },
  { name: 'Adherence', Section: AdherenceSection },
  { name: 'People', Section: PeopleSection },
  { name: 'Loading', Section: LoadingSection },
  { name: 'Screen states', Section: ScreenStatesSection },
  { name: 'Haptics', Section: HapticsSection },
];
