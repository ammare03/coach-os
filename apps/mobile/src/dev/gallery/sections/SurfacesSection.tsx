import {
  Card,
  Divider,
  GlassSurface,
  GlassSurfaceGroup,
  Metric,
  Text,
  colors,
  radius,
  useGlassAvailable,
  type CardElevation,
  type GlassTier,
} from '@coachos/ui';
import { Bell } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { GallerySection } from '../GallerySection.tsx';
import { Specimen } from '../Specimen.tsx';

// `DESIGN.md` §2's ladder, minus L4 — glass is a composite and lives in
// `GlassSurface` below, not in `Card`.
const ELEVATIONS: readonly CardElevation[] = ['canvas', 'inset', 'raised', 'tinted'];
const TIERS: readonly GlassTier[] = ['tier1', 'tier2', 'tier3'];

function noop() {
  // Inert specimen.
}

export function SurfacesSection() {
  const glass = useGlassAvailable();

  return (
    <GallerySection
      title="Surfaces"
      note="Card sits on exactly one elevation; glass is chrome only, and never over a chart."
    >
      <Specimen label="Card · every elevation, coach density" layout="column">
        {ELEVATIONS.map((elevation) => (
          <Card key={elevation} elevation={elevation} density="coach">
            <Text size="label">{elevation}</Text>
            <Text size="body-sm" tone="muted">
              Coach density — 14px padding.
            </Text>
          </Card>
        ))}
      </Specimen>

      <Specimen label="Card · every elevation, client density" layout="column">
        {ELEVATIONS.map((elevation) => (
          <Card key={elevation} elevation={elevation} density="client">
            <Text size="label">{elevation}</Text>
            <Text size="body-sm" tone="muted">
              Client density — 18px padding.
            </Text>
          </Card>
        ))}
      </Specimen>

      <Specimen label="Card · onPress (becomes a control, gets a role and a label)" layout="column">
        <Card onPress={noop} accessibilityLabel="Open Priya's week">
          <Text size="label">Pressable card</Text>
        </Card>
      </Specimen>

      <Specimen label="Divider · coach then client insets" layout="column">
        <Card elevation="raised" density="coach">
          <Text size="body-sm">Above</Text>
          <Divider density="coach" />
          <Text size="body-sm">Below</Text>
        </Card>
        <Card elevation="raised" density="client">
          <Text size="body-sm">Above</Text>
          <Divider density="client" />
          <Text size="body-sm">Below</Text>
        </Card>
      </Specimen>

      <Specimen label="useGlassAvailable · this device, right now" layout="column">
        <Card elevation="inset" density="coach">
          <Text size="body-sm" tone="muted">
            capable {String(glass.capable)} · reduceTransparency {String(glass.reduceTransparency)}{' '}
            · increaseContrast {String(glass.increaseContrast)} · canUseGlass{' '}
            {String(glass.canUseGlass)}
          </Text>
        </Card>
      </Specimen>

      <Specimen label="GlassSurface · every tier, over content" layout="column">
        <View style={styles.glassBed}>
          <Metric value="12,450" unit="kg" size="numeral-xl" tone="warm" />
          <View className="gap-12 pt-16">
            {TIERS.map((tier) => (
              <GlassSurface key={tier} tier={tier} style={styles.glassBar}>
                <Text size="label" tone="glass">
                  {tier}
                </Text>
              </GlassSurface>
            ))}
          </View>
        </View>
      </Specimen>

      <Specimen label="GlassSurface · interactive, and a white-label tint" layout="column">
        <View style={styles.glassBed}>
          <View className="flex-row gap-12">
            <GlassSurface tier="tier3" interactive style={styles.glassChip}>
              <Bell size={18} color={colors.fg.glass} />
            </GlassSurface>
            <GlassSurface tier="tier2" tint={colors.brand.lift} style={styles.glassChip}>
              <Text size="label" tone="glass">
                tint
              </Text>
            </GlassSurface>
          </View>
        </View>
      </Specimen>

      <Specimen label="GlassSurfaceGroup · adjacent surfaces merge" layout="column">
        <View style={styles.glassBed}>
          <GlassSurfaceGroup spacing={12} style={styles.glassRow}>
            <GlassSurface tier="tier3" style={styles.glassChip}>
              <Text size="label" tone="glass">
                A
              </Text>
            </GlassSurface>
            <GlassSurface tier="tier3" style={styles.glassChip}>
              <Text size="label" tone="glass">
                B
              </Text>
            </GlassSurface>
          </GlassSurfaceGroup>
        </View>
      </Specimen>
    </GallerySection>
  );
}

// Glass needs something behind it to be glass at all — a flat bed of the
// warm numeral is the smallest honest backdrop.
const styles = StyleSheet.create({
  glassBar: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 16,
  },
  glassBed: {
    alignItems: 'center',
    backgroundColor: colors.deep,
    borderRadius: radius.section,
    overflow: 'hidden',
    padding: 20,
  },
  glassChip: {
    alignItems: 'center',
    borderRadius: radius.full,
    height: 44,
    justifyContent: 'center',
    minWidth: 44,
    paddingHorizontal: 14,
  },
  glassRow: { flexDirection: 'row', gap: 12 },
});
