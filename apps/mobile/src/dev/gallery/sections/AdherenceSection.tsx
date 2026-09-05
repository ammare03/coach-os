import {
  AdherenceDot,
  AdherenceDotRow,
  ADHERENCE_STATE_LABEL,
  Text,
  type AdherenceDay,
  type AdherenceDotSize,
} from '@coachos/ui';
import type { AdherenceState } from '@coachos/utils';
import { View } from 'react-native';

import { GallerySection } from '../GallerySection.tsx';
import { Specimen } from '../Specimen.tsx';

// Both components take a state NAME, never a score — the thresholds live in
// `adherenceState()` in `packages/utils` and nowhere else.
const STATES: readonly AdherenceState[] = ['on-track', 'drifting', 'off-track', 'no-data'];
const SIZES: readonly AdherenceDotSize[] = ['sm', 'md'];

const TODAY = '2026-09-05';

const FULL_WEEK: AdherenceDay[] = [
  { dateISO: '2026-08-30', state: 'on-track' },
  { dateISO: '2026-08-31', state: 'on-track' },
  { dateISO: '2026-09-01', state: 'drifting' },
  { dateISO: '2026-09-02', state: 'off-track' },
  { dateISO: '2026-09-03', state: 'on-track' },
  { dateISO: '2026-09-04', state: 'drifting' },
  { dateISO: '2026-09-05', state: 'on-track' },
];

// Missing days render `no data`, and the row stays seven wide either way —
// that is what lets two clients be compared vertically down a list.
const PARTIAL_WEEK: AdherenceDay[] = [
  { dateISO: '2026-09-03', state: 'on-track' },
  { dateISO: '2026-09-05', state: 'drifting' },
  { dateISO: '2026-09-11', state: 'on-track' },
];

function noop() {
  // Inert specimen.
}

export function AdherenceSection() {
  return (
    <GallerySection
      title="Adherence"
      note="Colour plus a second channel, always — a brand-new client is grey, never red."
    >
      {SIZES.map((size) => (
        <Specimen key={size} label={`AdherenceDot · every state, size="${size}"`}>
          {STATES.map((state) => (
            <View key={state} className="items-center gap-4">
              <AdherenceDot state={state} size={size} />
              <Text size="micro" tone="faint">
                {ADHERENCE_STATE_LABEL[state]}
              </Text>
            </View>
          ))}
        </Specimen>
      ))}

      <Specimen label="AdherenceDot · with its key label (required past eight in one view)">
        {STATES.map((state) => (
          <AdherenceDot key={state} state={state} label={ADHERENCE_STATE_LABEL[state]} />
        ))}
      </Specimen>

      <Specimen label="AdherenceDot · tappable (a legend entry or a filter, never a row dot)">
        {STATES.map((state) => (
          <AdherenceDot
            key={state}
            state={state}
            label={ADHERENCE_STATE_LABEL[state]}
            onPress={noop}
          />
        ))}
      </Specimen>

      <Specimen label="AdherenceDotRow · training and nutrition, with day labels" layout="column">
        <View className="gap-16">
          <AdherenceDotRow
            days={FULL_WEEK}
            metric="training"
            todayISO={TODAY}
            showDayLabels
            onPress={noop}
          />
          <AdherenceDotRow
            days={FULL_WEEK}
            metric="nutrition"
            todayISO={TODAY}
            showDayLabels
            onPress={noop}
          />
        </View>
      </Specimen>

      <Specimen label="AdherenceDotRow · dense list row (no labels), both sizes" layout="column">
        <View className="gap-16">
          <AdherenceDotRow days={FULL_WEEK} metric="training" todayISO={TODAY} size="sm" />
          <AdherenceDotRow days={FULL_WEEK} metric="training" todayISO={TODAY} size="md" />
        </View>
      </Specimen>

      <Specimen
        label="AdherenceDotRow · partial data, and days outside the window ignored"
        layout="column"
      >
        <View className="gap-16">
          <AdherenceDotRow days={PARTIAL_WEEK} metric="training" todayISO={TODAY} showDayLabels />
          <AdherenceDotRow days={[]} metric="nutrition" todayISO={TODAY} showDayLabels />
        </View>
      </Specimen>
    </GallerySection>
  );
}
