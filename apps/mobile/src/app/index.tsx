import {
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
  SegmentedControl,
  Sheet,
  SheetFooter,
  SheetHeader,
  Text,
} from '@coachos/ui';
import { colors } from '@coachos/ui/theme';
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

export default function HomeScreen() {
  const ping = api.health.ping.useQuery();
  const [facet, setFacet] = useState<'training' | 'body' | 'habits'>('training');
  const [selectedChips, setSelectedChips] = useState<string[]>(['Needs you']);
  const [note, setNote] = useState('');
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

      <View style={styles.row}>
        <Link href="/sign-in" style={styles.link}>
          Sign in
        </Link>
        <Link href="/sign-up" style={styles.link}>
          Create account
        </Link>
      </View>

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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
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
