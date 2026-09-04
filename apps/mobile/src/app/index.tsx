import {
  AdherenceDot,
  AdherenceDotRow,
  Avatar,
  AvatarStack,
  Badge,
  Button,
  Card,
  Chip,
  ConfirmModal,
  Divider,
  FormField,
  GlassSurface,
  IconButton,
  Input,
  Metric,
  NumberStepper,
  SegmentedControl,
  Sheet,
  SheetFooter,
  SheetHeader,
  Skeleton,
  SkeletonCircle,
  SkeletonText,
  Text,
} from '@coachos/ui';
import { colors } from '@coachos/ui/theme';
import type { AdherenceState } from '@coachos/utils';
import { Link } from 'expo-router';
import { Plus, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { api } from '../lib/trpc.ts';

// The temporary home screen, doubling as `ui-primitives-core`'s visual
// proof: tasks 01, 02, 03, 05 and 06 each require their components rendered
// somewhere a physical device can show them, because the hit areas, the
// elevation separation, and the 200%-text behaviour cannot be verified any
// other way. `phase-04-design-system/component-gallery/` replaces this with
// the permanent gallery, and `phase-05-app-shell/` replaces the route.
//
// This is scaffolding, not a designed screen — it deliberately has no
// hierarchy of its own, so nothing here should be copied into a real one.

const PEOPLE = [
  { userId: 'u1', name: 'Priya Sharma' },
  { userId: 'u2', name: 'Arjun Mehta' },
  { userId: 'u3', name: 'Sara Khan' },
  { userId: 'u4', name: 'Ravi Iyer' },
  { userId: 'u5', name: 'Mei Tanaka' },
  { userId: 'u6', name: 'अनिल कुमार' },
];

// `ui-primitives-data/03`'s visual proof. A fixed date rather than
// `new Date()` so the strip is identical on every device and every run —
// a real screen resolves today in the CLIENT's timezone via `toLocalDate()`
// from `@coachos/utils`, never from the device clock (`code-conventions` §6).
const SAMPLE_TODAY = '2026-09-04';
const SAMPLE_WEEK = [
  '2026-08-29',
  '2026-08-30',
  '2026-08-31',
  '2026-09-01',
  '2026-09-02',
  '2026-09-03',
  '2026-09-04',
] as const;

const SAMPLE_WEEKS: {
  label: string;
  metric: 'training' | 'nutrition';
  states: AdherenceState[];
}[] = [
  {
    label: 'Priya Sharma',
    metric: 'training',
    states: ['on-track', 'on-track', 'drifting', 'on-track', 'off-track', 'on-track', 'drifting'],
  },
  {
    label: 'Nikhil Rao',
    metric: 'training',
    states: ['off-track', 'off-track', 'no-data', 'off-track', 'no-data', 'no-data', 'no-data'],
  },
  // The row this component exists to get right: a client invited an hour
  // ago is seven dashed grey dots, never a row of red.
  {
    label: 'Leah Osei · invited',
    metric: 'nutrition',
    states: ['no-data', 'no-data', 'no-data', 'no-data', 'no-data', 'no-data', 'no-data'],
  },
];

export default function HomeScreen() {
  const ping = api.health.ping.useQuery();
  const [facet, setFacet] = useState<'training' | 'body' | 'habits'>('training');
  const [selectedChips, setSelectedChips] = useState<string[]>(['Needs you']);
  const [note, setNote] = useState('');
  const [weightKg, setWeightKg] = useState(62.5);
  const [reps, setReps] = useState(8);
  const [rpe, setRpe] = useState(8);
  const [isSheetOpen, setSheetOpen] = useState(false);
  const [isConfirmOpen, setConfirmOpen] = useState(false);

  const toggleChip = (label: string) =>
    setSelectedChips((prev) =>
      prev.includes(label) ? prev.filter((c) => c !== label) : [...prev, label],
    );

  return (
    <ScrollView contentContainerStyle={styles.container} className="bg-bg">
      <Text size="h1">CoachOS</Text>
      <Text tone="muted" size="body-sm">
        {ping.data
          ? `API: ${ping.data.status} @ ${ping.data.serverTime.toISOString()}`
          : 'Checking API…'}
      </Text>

      {/* Every route in the app, so each screen is reachable for visual
          review before `phase-05-app-shell/router-skeleton/` builds the
          real navigation. None of these needs the API to render. */}
      <Section title="Screens">
        <View style={styles.wrap}>
          {(
            [
              ['/sign-in', 'Sign in'],
              ['/sign-up', 'Create account'],
              ['/complete-social-signup', 'Complete social sign-up'],
              ['/your-data', 'Your data'],
            ] as const
          ).map(([href, label]) => (
            <Link key={href} href={href} style={styles.link}>
              {label}
            </Link>
          ))}
        </View>
      </Section>

      {/* Type scale — every size and its pinned face, plus a Metric with
          its unit stepped down and tabular numerals. */}
      <Section title="Type">
        <Text size="display">52</Text>
        <Text size="h2">Priya Sharma</Text>
        <Text size="title">Add to breakfast</Text>
        <Text size="body-lg">Great depth on those squats.</Text>
        <Text size="body">Default body.</Text>
        <Text size="body-sm" tone="muted">
          New form check · Squat
        </Text>
        <Text size="caption" tone="subtle">
          Marcus · 2h ago
        </Text>
        <Text size="eyebrow" tone="muted">
          THIS WEEK
        </Text>
        <Metric value="62.5" unit="kg" size="numeral-xl" tone="bright" />
      </Section>

      {/* The elevation ladder, nested. Two things are being checked at
          once: that the levels are distinguishable on a real display in a
          bright room (they are only a few points apart in lightness), and
          that `compact` reads as denser without reading as smaller. */}
      <Section title="Elevation, nested">
        <Card elevation="raised" density="client">
          <Text size="label">L2 raised · client</Text>
          <Divider density="client" />
          <Text size="body-sm" tone="muted">
            The workhorse — gradient fill, hairline top highlight, soft drop.
          </Text>
          <Card elevation="tinted" density="coach">
            <Text size="label">L3 tinted · coach</Text>
            <Text size="body-sm" tone="warm-muted">
              &quot;This one is different&quot;, without colour-coding it.
            </Text>
          </Card>
        </Card>
        <Card elevation="inset" density="coach">
          <Text size="body-sm" tone="muted">
            L1 inset — a recessed well.
          </Text>
        </Card>
        <Card elevation="raised" density="client" onPress={() => undefined}>
          <Text size="body-sm">Pressable card — announces as a button.</Text>
        </Card>
      </Section>

      {/* All twelve button combinations, plus disabled and loading. The
          twelfth is the one nobody looks at, so they are all here rather
          than the four a first screen happens to need. */}
      <Section title="Buttons">
        {(['primary', 'secondary', 'ghost', 'danger'] as const).map((variant) => (
          <View key={variant} style={styles.row}>
            {(['sm', 'md', 'lg'] as const).map((size) => (
              <Button key={size} variant={variant} size={size} onPress={() => undefined}>
                {`${variant} ${size}`}
              </Button>
            ))}
          </View>
        ))}
        <View style={styles.row}>
          <Button disabled onPress={() => undefined}>
            Disabled
          </Button>
          <Button loading onPress={() => undefined}>
            Loading
          </Button>
          <Button fullWidth={false} iconLeft={<Plus size={18} />} onPress={() => undefined}>
            With icon
          </Button>
        </View>
        <View style={styles.row}>
          <IconButton
            icon={<Plus size={20} />}
            onPress={() => undefined}
            accessibilityLabel="Add an exercise"
          />
          <IconButton
            icon={<Trash2 size={20} />}
            variant="danger"
            onPress={() => undefined}
            accessibilityLabel="Remove this set"
          />
        </View>
      </Section>

      {/* A form, including a field in its error state — the error must not
          shift the field below it, and the glyph must carry the meaning
          that colour is not allowed to. */}
      <Section title="Form">
        <FormField label="Session note" hint="Your client sees this." density="client">
          <Input
            value={note}
            onChangeText={setNote}
            placeholder="How did the session go?"
            density="client"
          />
        </FormField>
        <FormField label="Email" error="Enter a valid email address." isRequired density="client">
          <Input
            value="not-an-email"
            onChangeText={() => undefined}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            state="error"
            density="client"
          />
        </FormField>
        <FormField label="Disabled" density="coach">
          <Input value="Locked" onChangeText={() => undefined} state="disabled" density="coach" />
        </FormField>
      </Section>

      {/* The logger's core input, at both densities and at three of its
          seven step sizes. Every acceptance criterion that matters here is
          physical — 48px hit areas under the Android layout-bounds overlay,
          a four-digit value unclipped at 200% text, and the value not
          jittering as it crosses 99 → 100 — and none of them can be checked
          in a simulator (`ui-conventions` §9). */}
      <Section title="Steppers">
        <NumberStepper
          value={weightKg}
          onChange={setWeightKg}
          step={2.5}
          min={0}
          max={300}
          unit="kg"
          unitLabel="kilograms"
          accessibilityLabel="weight"
          testID="stepper-weight"
        />
        <NumberStepper
          value={reps}
          onChange={setReps}
          step={1}
          min={1}
          max={50}
          accessibilityLabel="reps"
          testID="stepper-reps"
        />
        <NumberStepper
          value={rpe}
          onChange={setRpe}
          step={0.5}
          min={5}
          max={10}
          density="coach"
          accessibilityLabel="RPE"
          testID="stepper-rpe"
        />
      </Section>

      {/* A wrapping chip row — never horizontally scrolling, so a client
          choosing equipment or restrictions can see every option. */}
      <Section title="Chips, badges, segments">
        <View style={styles.wrap}>
          {['Needs you', 'All 24', 'Unreviewed', 'Paused', 'New this week'].map((label) => (
            <Chip
              key={label}
              label={label}
              selected={selectedChips.includes(label)}
              onPress={() => toggleChip(label)}
            />
          ))}
          <Chip label="Squat" onPress={() => undefined} onRemove={() => undefined} />
        </View>
        <View style={styles.row}>
          <Badge count={3} />
          <Badge count={128} />
          <Badge label="Live" tone="brand" />
          <Badge tone="brand" />
        </View>
        <SegmentedControl
          options={[
            { value: 'training', label: 'Training' },
            { value: 'body', label: 'Body' },
            { value: 'habits', label: 'Habits' },
          ]}
          value={facet}
          onChange={setFacet}
        />
      </Section>

      {/* `ui-primitives-data/03`. Three things can only be checked here, on
          hardware: that the four states are still distinguishable with the
          OS greyscale filter on (turn it on — this is the important one),
          that the dashed `not started` ring actually renders dashed on
          Android rather than collapsing to solid, and that a week strip
          survives 200% text size with its day letters shown. */}
      <Section title="Adherence">
        {/* All four states at both sizes, one row each, so the fill/hollow/
            dashed channel is comparable rather than remembered. */}
        {(['sm', 'md'] as const).map((size) => (
          <View key={size} style={styles.row}>
            {(['on-track', 'drifting', 'off-track', 'no-data'] as const).map((state) => (
              <AdherenceDot key={state} state={state} size={size} />
            ))}
            <Text size="caption" tone="subtle">
              {size === 'sm' ? '11px · coach row' : '12px · client detail'}
            </Text>
          </View>
        ))}

        {/* The key §8 requires wherever the state graphic appears more than
            eight times in one view. */}
        <View style={styles.wrap}>
          <AdherenceDot state="on-track" label="On plan" />
          <AdherenceDot state="drifting" label="Drifting" />
          <AdherenceDot state="off-track" label="Off plan" />
          <AdherenceDot state="no-data" label="Not started" />
        </View>

        {/* Three sample client rows. They must stay aligned down the column
            — that alignment is the whole reason the strip pads to seven. */}
        {SAMPLE_WEEKS.map((week) => (
          <View key={week.label} style={styles.adherenceRow}>
            <Text size="body-sm" tone="muted" numberOfLines={1} style={styles.adherenceName}>
              {week.label}
            </Text>
            <AdherenceDotRow
              days={week.states.map((state, index) => ({
                dateISO: SAMPLE_WEEK[index] ?? SAMPLE_TODAY,
                state,
              }))}
              metric={week.metric}
              todayISO={SAMPLE_TODAY}
              onPress={() => undefined}
            />
          </View>
        ))}

        {/* The same strip at `md` with day letters — today's letter is the
            bright one, at the right-hand end. */}
        <AdherenceDotRow
          days={
            SAMPLE_WEEKS[0]?.states.map((state, index) => ({
              dateISO: SAMPLE_WEEK[index] ?? SAMPLE_TODAY,
              state,
            })) ?? []
          }
          metric="training"
          todayISO={SAMPLE_TODAY}
          size="md"
          showDayLabels
        />
      </Section>

      {/* Four sizes and a fallback grid. The non-Latin name is here on
          purpose — grapheme-aware initials are easy to get wrong and easy
          not to notice if everyone testing has a Latin name. */}
      <Section title="Avatars">
        <View style={styles.row}>
          {(['xs', 'sm', 'md', 'lg'] as const).map((size) => (
            <Avatar key={size} size={size} name="Priya Sharma" userId="u1" />
          ))}
        </View>
        <View style={styles.wrap}>
          {PEOPLE.map((p) => (
            <Avatar key={p.userId} size="sm" name={p.name} userId={p.userId} />
          ))}
          <Avatar size="sm" name="" userId="u7" />
          <Avatar size="sm" name="Ravi Iyer" userId="u4" presence="online" />
        </View>
        <AvatarStack people={PEOPLE} max={4} size="sm" />
      </Section>

      {/* Tier-1 glass. On Android and iOS < 26 this is expo-blur with the
          tier gradient; under Reduce Transparency it is fully opaque. All
          three paths are supposed to be legible — that is the point. */}
      <Section title="Glass">
        <GlassSurface tier="tier1" style={styles.glass}>
          <Text size="label" tone="glass">
            Tier 1 · dock and action bar
          </Text>
          <Text size="body-sm" tone="warm-muted">
            Text on glass steps up to the glass ramp.
          </Text>
        </GlassSurface>
      </Section>

      {/* The two shapes every loading state is made of: a card and a list
          row. Both reserve exactly the box the real content will take, so
          nothing shifts when data lands. Toggle Reduce Motion on the device
          — the sweep must stop and the static fill must stay. */}
      <Section title="Loading">
        <Card elevation="raised" density="client">
          <View style={styles.skeletonCard}>
            <SkeletonText size="eyebrow" lastLineWidth="34%" accessibilityLabel="Loading" />
            <Skeleton height={30} width="58%" radius="control" />
            <SkeletonText size="body-sm" lines={2} lastLineWidth="62%" />
          </View>
        </Card>
        {[0, 1, 2].map((row) => (
          <View key={row} style={styles.skeletonRow}>
            <SkeletonCircle
              diameter={36}
              accessibilityLabel={row === 0 ? 'Loading clients' : undefined}
            />
            <View style={styles.skeletonRowBody}>
              <SkeletonText size="body" lastLineWidth="62%" />
              <SkeletonText size="caption" lastLineWidth="38%" />
            </View>
          </View>
        ))}
      </Section>

      <Section title="Overlays">
        <View style={styles.row}>
          <Button onPress={() => setSheetOpen(true)}>Open sheet</Button>
          <Button variant="danger" onPress={() => setConfirmOpen(true)}>
            Delete account
          </Button>
        </View>
      </Section>

      <Sheet isOpen={isSheetOpen} onDismiss={() => setSheetOpen(false)} snap="auto">
        <SheetHeader
          title="Add to breakfast"
          subtitle="Search or scan a barcode"
          onClose={() => setSheetOpen(false)}
          density="client"
        />
        <View style={styles.sheetBody}>
          <FormField label="Search foods" density="client">
            <Input
              value=""
              onChangeText={() => undefined}
              placeholder="Oats, banana…"
              density="client"
            />
          </FormField>
        </View>
        {/* The action label counts the selection (§10.8), and stays inert
            until something is actually picked. */}
        <SheetFooter
          actionLabel="Add 2 items"
          onAction={() => setSheetOpen(false)}
          isActionDisabled={false}
          density="client"
        />
      </Sheet>

      <ConfirmModal
        isOpen={isConfirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => setConfirmOpen(false)}
        title="Delete your account"
        body="Your workouts, photos, and messages are removed after a 7-day grace period. You can cancel any time before then."
        confirmationText="DELETE"
        actionLabel="Delete account"
      />
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text size="eyebrow" tone="muted">
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 26,
  },
  section: {
    gap: 12,
  },
  // §9's list row: 66px tall, 12px gap, 36px avatar.
  skeletonCard: {
    gap: 11,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 66,
    gap: 12,
  },
  skeletonRowBody: {
    flex: 1,
    gap: 3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  adherenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  adherenceName: {
    width: 132,
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  glass: {
    padding: 18,
    gap: 4,
  },
  sheetBody: {
    padding: 18,
  },
  link: {
    color: colors.brand.DEFAULT,
  },
});
