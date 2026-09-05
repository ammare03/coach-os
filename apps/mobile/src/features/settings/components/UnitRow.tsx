// `account-lifecycle/08` — the weight-unit preference card. Design:
// `/design` round 1, Option B ("live comparison"), picked over a plain
// settings row and a dedicated decision screen. Font is `System`
// (platform default), matching `SignUpForm.tsx`'s own `heading` style —
// not `DESIGN.md` §1.2's Space Grotesk / Instrument Sans, which nothing in
// this app has actually loaded yet.
//
// Every colour now reaches the screen through `useTheme()` /
// `createThemedStyles` rather than a module-scope `colors` import, which
// baked the dark table in at load and left the selected tile on the
// retired `DESIGN-SYSTEM.md` indigo (#A5A9FB text over a 99,102,241 tint).
// Roles are unchanged; only the ramp underneath them is `DESIGN.md` §1.1's.
//
// Switching is instant and lossless (CLAUDE.md §17.2, this task's Approach
// step 5): tapping a tile updates `packages/db`'s `users.weight_unit`
// optimistically, with no confirmation and nothing to roll back visually
// on success — only `me.get`'s cache entry moves.
import { createThemedStyles, Pressable, radius, spacing, useTheme } from '@coachos/ui';
import { formatWeight, weightStepFor, type WeightUnit } from '@coachos/utils';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { api } from '../../../lib/trpc.ts';

// A fixed, round reference value — never a client's own logged weight.
// `me.get` carries no workout history, and fabricating "your last squat"
// here would mean either a second query this component doesn't need or
// a lie for a brand-new client with nothing logged yet.
const EXAMPLE_KG = 100;

function CheckBadge() {
  const theme = useTheme();

  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} fill={theme.colors.brand.DEFAULT} />
      <Path
        d="M8 12.5l2.5 2.5 5-5.5"
        stroke={theme.colors.fg.onBrand}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

interface UnitTileProps {
  unit: WeightUnit;
  label: string;
  displayValue: string;
  selected: boolean;
  onPress: () => void;
}

function UnitTile({ unit, label, displayValue, selected, onPress }: UnitTileProps) {
  const themed = useThemedStyles();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}, ${displayValue}${unit === 'kg' ? ' kilograms' : ' pounds'}`}
      style={[styles.tile, selected ? themed.tileSelected : themed.tileIdle]}
    >
      {selected ? (
        <View style={styles.checkBadge}>
          <CheckBadge />
        </View>
      ) : null}
      <Text style={[styles.tileLabel, selected ? themed.tileLabelSelected : themed.tileLabel]}>
        {unit}
      </Text>
      <Text style={[styles.tileValue, selected ? themed.tileValue : themed.tileValueIdle]}>
        {displayValue}
      </Text>
      <Text style={[styles.tileCaption, themed.tileCaption]}>steps of {weightStepFor(unit)}</Text>
    </Pressable>
  );
}

export function UnitRow() {
  const themed = useThemedStyles();
  const { data: me } = api.me.get.useQuery();
  const utils = api.useUtils();
  const updatePreferences = api.me.updatePreferences.useMutation({
    onMutate: async (input) => {
      await utils.me.get.cancel();
      const previous = utils.me.get.getData();
      if (previous && input.weightUnit) {
        utils.me.get.setData(undefined, { ...previous, weightUnit: input.weightUnit });
      }
      return { previous };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) {
        utils.me.get.setData(undefined, context.previous);
      }
    },
    onSettled: () => {
      void utils.me.get.invalidate();
    },
  });

  const unit: WeightUnit = me?.weightUnit ?? 'kg';

  function selectUnit(next: WeightUnit) {
    if (next === unit) return;
    updatePreferences.mutate({ weightUnit: next });
  }

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, themed.sectionLabel]}>Weight unit</Text>
      <View style={[styles.card, themed.card]}>
        <Text style={[styles.exampleCaption, themed.exampleCaption]}>Example</Text>
        <View style={styles.tileRow}>
          <UnitTile
            unit="kg"
            label="Kilograms"
            displayValue={formatWeight(EXAMPLE_KG, 'kg')}
            selected={unit === 'kg'}
            onPress={() => selectUnit('kg')}
          />
          <UnitTile
            unit="lb"
            label="Pounds"
            displayValue={formatWeight(EXAMPLE_KG, 'lb')}
            selected={unit === 'lb'}
            onPress={() => selectUnit('lb')}
          />
        </View>
        <Text style={[styles.footnote, themed.footnote]}>
          Nothing is converted or re-saved — this only changes how numbers are shown.
        </Text>
      </View>
    </View>
  );
}

// Scheme-invariant geometry only — every colour lives in the themed sheet
// below (`createThemedStyles`' own contract).
const styles = StyleSheet.create({
  section: {
    gap: spacing(8),
  },
  sectionLabel: {
    fontFamily: 'System',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    paddingHorizontal: spacing(4),
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.card,
    padding: spacing(20),
    gap: spacing(16),
  },
  exampleCaption: {
    fontFamily: 'System',
    fontSize: 12,
    lineHeight: 16,
  },
  tileRow: {
    flexDirection: 'row',
    gap: spacing(12),
  },
  tile: {
    flex: 1,
    position: 'relative',
    borderRadius: radius.control,
    padding: spacing(16),
    borderWidth: 1,
    minHeight: 48,
  },
  checkBadge: {
    position: 'absolute',
    top: spacing(12),
    right: spacing(12),
  },
  tileLabel: {
    fontFamily: 'System',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  tileValue: {
    fontFamily: 'System',
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    marginTop: spacing(4),
  },
  tileCaption: {
    fontFamily: 'System',
    fontSize: 12,
    lineHeight: 16,
    marginTop: spacing(4),
  },
  footnote: {
    fontFamily: 'System',
    fontSize: 12,
    lineHeight: 16,
  },
});

// The selected tile was an indigo wash: `rgba(99,102,241,.08)` fill,
// `rgba(99,102,241,.6)` border, `#A5A9FB` label. That is `DESIGN.md` §2's
// L3 *tinted* surface — "the only way to say 'this one is different'
// without colour-coding it" — so the fill reads the ladder's own tinted
// stop rather than a second hand-mixed alpha, flattened to one stop because
// the tile is a plain `View`, not a `LinearGradient`. The border stays a
// full-strength `brand`, which §1.1 gives the "active state" role, and the
// label follows it: `brand` on that fill measures 6.06:1, clearing 4.5:1
// for its 13px.
//
// Selection is never carried by colour alone — the tile also wears the
// `CheckBadge` tick and reports `accessibilityState={{ selected }}`
// (`accessibility` §4).
const useThemedStyles = createThemedStyles((theme) => ({
  sectionLabel: { color: theme.colors.fg.muted },
  card: {
    backgroundColor: theme.colors.bg.raised,
    borderColor: theme.colors.border.soft,
  },
  exampleCaption: { color: theme.colors.fg.muted },
  tileIdle: {
    backgroundColor: theme.colors.bg.inset,
    borderColor: theme.colors.border.soft,
  },
  tileSelected: {
    backgroundColor: theme.elevation.tinted.gradient[1],
    borderColor: theme.colors.brand.DEFAULT,
  },
  tileLabel: { color: theme.colors.fg.muted },
  tileLabelSelected: { color: theme.colors.brand.DEFAULT },
  tileValue: { color: theme.colors.fg.DEFAULT },
  tileValueIdle: { color: theme.colors.fg.subtle },
  tileCaption: { color: theme.colors.fg.muted },
  footnote: { color: theme.colors.fg.muted },
}));
