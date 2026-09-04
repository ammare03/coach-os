// `account-lifecycle/08` — the weight-unit preference card. Design:
// `/design` round 1, Option B ("live comparison"), picked over a plain
// settings row and a dedicated decision screen. Font is `System`
// (platform default), matching `SignUpForm.tsx`'s own `heading` style —
// not `DESIGN-SYSTEM.md` DS§3's Inter/Inter Tight, which nothing in this
// app has actually loaded yet.
//
// Switching is instant and lossless (CLAUDE.md §17.2, this task's Approach
// step 5): tapping a tile updates `packages/db`'s `users.weight_unit`
// optimistically, with no confirmation and nothing to roll back visually
// on success — only `me.get`'s cache entry moves.
import { colors, Pressable, radius, spacing } from '@coachos/ui';
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
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} fill={colors.brand.DEFAULT} />
      <Path
        d="M8 12.5l2.5 2.5 5-5.5"
        stroke={colors.fg.onBrand}
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
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}, ${displayValue}${unit === 'kg' ? ' kilograms' : ' pounds'}`}
      style={[styles.tile, selected ? styles.tileSelected : styles.tileIdle]}
    >
      {selected ? (
        <View style={styles.checkBadge}>
          <CheckBadge />
        </View>
      ) : null}
      <Text style={[styles.tileLabel, selected && styles.tileLabelSelected]}>{unit}</Text>
      <Text style={[styles.tileValue, !selected && styles.tileValueIdle]}>{displayValue}</Text>
      <Text style={styles.tileCaption}>steps of {weightStepFor(unit)}</Text>
    </Pressable>
  );
}

export function UnitRow() {
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
      <Text style={styles.sectionLabel}>Weight unit</Text>
      <View style={styles.card}>
        <Text style={styles.exampleCaption}>Example</Text>
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
        <Text style={styles.footnote}>
          Nothing is converted or re-saved — this only changes how numbers are shown.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing(2),
  },
  sectionLabel: {
    fontFamily: 'System',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.fg.muted,
    paddingHorizontal: spacing(1),
  },
  card: {
    backgroundColor: colors.bg.raised,
    borderWidth: 1,
    borderColor: colors.border.soft,
    borderRadius: radius.card,
    padding: spacing(5),
    gap: spacing(4),
  },
  exampleCaption: {
    fontFamily: 'System',
    fontSize: 12,
    lineHeight: 16,
    color: colors.fg.subtle,
  },
  tileRow: {
    flexDirection: 'row',
    gap: spacing(3),
  },
  tile: {
    flex: 1,
    position: 'relative',
    borderRadius: radius.control,
    padding: spacing(4),
    borderWidth: 1,
    minHeight: 48,
  },
  tileIdle: {
    backgroundColor: colors.bg.inset,
    borderColor: colors.border.soft,
  },
  tileSelected: {
    backgroundColor: 'rgba(99,102,241,0.08)',
    borderColor: 'rgba(99,102,241,0.6)',
  },
  checkBadge: {
    position: 'absolute',
    top: spacing(3),
    right: spacing(3),
  },
  tileLabel: {
    fontFamily: 'System',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.fg.subtle,
  },
  tileLabelSelected: {
    color: '#A5A9FB',
  },
  tileValue: {
    fontFamily: 'System',
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    color: colors.fg.DEFAULT,
    marginTop: spacing(1),
  },
  tileValueIdle: {
    color: colors.fg.subtle,
  },
  tileCaption: {
    fontFamily: 'System',
    fontSize: 12,
    lineHeight: 16,
    color: colors.fg.subtle,
    marginTop: spacing(1),
  },
  footnote: {
    fontFamily: 'System',
    fontSize: 12,
    lineHeight: 16,
    color: colors.fg.subtle,
  },
});
