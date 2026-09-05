import { X } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { density as densityTokens, type Density } from '../theme/tokens.ts';
import { useTheme } from '../theme/useTheme.ts';

import { IconButton } from './IconButton.tsx';
import { Text } from './Text.tsx';

export type SheetHeaderProps = {
  title: string;
  subtitle?: string;
  /** Omit to render no close affordance — the sheet is then dismissed by the handle or the backdrop. */
  onClose?: () => void;
  density?: Density;
};

/**
 * The title/close row every sheet shares. One anatomy, defined once, so a
 * sheet in P09 and a sheet in P13 do not each invent their own.
 *
 * Text steps up to the glass ramp (`DESIGN.md` §4) because the sheet's
 * surface is tier-2 glass — `fg.glass` for the title, `fg.warm-muted` for
 * the subtitle.
 */
export function SheetHeader({ title, subtitle, onClose, density = 'client' }: SheetHeaderProps) {
  const { colors } = useTheme();
  const pad = densityTokens[density].cardPadding;

  return (
    <View style={[styles.row, { paddingHorizontal: pad, paddingTop: pad }]}>
      <View style={styles.titles}>
        <Text size="title" tone="glass" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text size="body-sm" tone="warm-muted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {onClose ? (
        <IconButton
          icon={<X size={20} color={colors.fg.glass} />}
          variant="ghost"
          size="sm"
          onPress={onClose}
          accessibilityLabel="Close"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  titles: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
});
