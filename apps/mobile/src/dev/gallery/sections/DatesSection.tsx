import { Calendar, Text, colors, type CalendarMarker, type CalendarRange } from '@coachos/ui';
import type { CalendarDate } from '@coachos/utils';
import { useState } from 'react';
import { View } from 'react-native';

import { GallerySection } from '../GallerySection.tsx';
import { Specimen } from '../Specimen.tsx';

// Fixed dates, not `new Date()` — a gallery that moves with the wall clock
// can't be compared against yesterday's screenshot.
const TODAY: CalendarDate = '2026-09-05';
const INITIAL_MONTH: CalendarDate = '2026-09-01';

// A marker carries a colour AND a label: hue alone is meaningless to a
// screen reader and to a colour-blind reader (`DESIGN.md` §8).
const MARKERS: ReadonlyMap<CalendarDate, CalendarMarker> = new Map([
  ['2026-09-01', { color: colors.brand.DEFAULT, label: 'Session logged' }],
  ['2026-09-03', { color: colors.brand.mid, label: 'Check-in submitted' }],
  ['2026-09-04', { color: colors.brand.deep, label: 'Form check uploaded' }],
  ['2026-09-08', { color: colors.brand.DEFAULT, label: 'Session scheduled' }],
]);

export function DatesSection() {
  const [single, setSingle] = useState<CalendarDate | null>(TODAY);
  const [range, setRange] = useState<CalendarRange | null>({
    start: '2026-09-02',
    end: '2026-09-09',
  });
  const [coachSingle, setCoachSingle] = useState<CalendarDate | null>('2026-09-10');
  const [bounded, setBounded] = useState<CalendarDate | null>('2026-09-05');
  const [sundayStart, setSundayStart] = useState<CalendarDate | null>('2026-09-05');

  return (
    <GallerySection
      title="Calendar"
      note="Every date crossing this boundary is a yyyy-MM-dd string — never a JS Date."
    >
      <Specimen label='mode="single" · client density, markers, today ringed' layout="column">
        <Calendar
          selected={single}
          onSelect={setSingle}
          today={TODAY}
          initialMonth={INITIAL_MONTH}
          markers={MARKERS}
          density="client"
        />
      </Specimen>

      <Specimen label='mode="single" · coach density' layout="column">
        <Calendar
          selected={coachSingle}
          onSelect={setCoachSingle}
          today={TODAY}
          initialMonth={INITIAL_MONTH}
          density="coach"
        />
      </Specimen>

      <Specimen label='mode="range" · half-picked ranges keep end null' layout="column">
        <Calendar
          mode="range"
          selected={range}
          onSelect={setRange}
          today={TODAY}
          initialMonth={INITIAL_MONTH}
          density="client"
        />
        <View className="pt-8">
          <Text size="body-sm" tone="muted">
            {range ? `${range.start} → ${range.end ?? '…'}` : 'nothing selected'}
          </Text>
        </View>
      </Specimen>

      <Specimen
        label="minDate / maxDate · days outside the window are unselectable"
        layout="column"
      >
        <Calendar
          selected={bounded}
          onSelect={setBounded}
          today={TODAY}
          initialMonth={INITIAL_MONTH}
          minDate="2026-09-02"
          maxDate="2026-09-18"
          density="coach"
        />
      </Specimen>

      <Specimen label='weekStartsOn={0} · Sunday first, locale="en-GB"' layout="column">
        <Calendar
          selected={sundayStart}
          onSelect={setSundayStart}
          today={TODAY}
          initialMonth={INITIAL_MONTH}
          weekStartsOn={0}
          locale="en-GB"
          density="coach"
        />
      </Specimen>
    </GallerySection>
  );
}
