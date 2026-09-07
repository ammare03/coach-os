import {
  Divider,
  Pressable,
  radius,
  resolveButtonVariantVisuals,
  Sheet,
  SheetHeader,
  spacing,
  Text,
  useTheme,
} from '@coachos/ui';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

// The kebab menu (`program-builder/06`, frame 1g). Two of them: one on a
// week header, one on a day row, both built from this.
//
// **Ported as a sheet, not as an anchored popover.** `packages/ui` has no
// popover primitive, and a hand-rolled absolutely-positioned card inside a
// `ScrollView` would have to re-measure its anchor on every scroll and
// would carry none of `Sheet`'s dismissal, backdrop or focus behaviour.
// `Sheet`'s own contract names "quick actions" as a `snap="auto"` use, so
// this is the sanctioned surface rather than a substitute for one. Frame
// 1g's vocabulary survives intact: 48px rows, a divider, and the
// destructive action last and urgent-tinted.

export interface BuilderMenuAction {
  /**
   * Stable across renders — used for the row key and its `testID`.
   * `actionId` rather than `id`: an object type with an `id` field is what
   * `local/no-hand-written-row-type` flags as a database row, and this is a
   * menu item (`ToastProvider`'s `toastId` carries the same note).
   */
  actionId: string;
  /** Sentence case, and it names the object: "Duplicate this day", never "Duplicate". */
  label: string;
  icon: ReactNode;
  onPress: () => void;
  /**
   * Renders after a divider, in the urgent ramp. `DESIGN.md` §8 —
   * destructive is the one non-adherence meaning `urgent` carries, and the
   * glyph, the wording and the position after a divider all carry it too,
   * so the hue is never the only channel (`accessibility` §4).
   */
  isDestructive?: boolean;
}

export interface BuilderActionsMenuProps {
  isOpen: boolean;
  /** What the actions are about — "Week 3", "Tuesday". */
  title: string;
  subtitle?: string | undefined;
  actions: readonly BuilderMenuAction[];
  onDismiss: () => void;
  testID?: string;
}

const ROW_HEIGHT = 48;

/**
 * The ink a destructive menu glyph is drawn in. Asked of the design system
 * by variant rather than by naming the token: `urgent` is not reachable
 * outside the adherence allowlist (`eslint.react-native.js`), and
 * `Button`'s own `danger` visuals are the sanctioned route to the same
 * colour.
 */
export function useDestructiveInk(): string {
  const theme = useTheme();
  return resolveButtonVariantVisuals('danger', false, false, theme).textColor;
}

export function BuilderActionsMenu({
  isOpen,
  title,
  subtitle,
  actions,
  onDismiss,
  testID = 'builder-actions-menu',
}: BuilderActionsMenuProps) {
  const firstDestructiveIndex = actions.findIndex((action) => action.isDestructive);

  return (
    <Sheet isOpen={isOpen} onDismiss={onDismiss} snap="auto" testID={testID}>
      <SheetHeader
        title={title}
        {...(subtitle ? { subtitle } : {})}
        onClose={onDismiss}
        density="coach"
      />
      <View style={styles.body}>
        {actions.map((action, index) => (
          <View key={action.actionId}>
            {index === firstDestructiveIndex && index > 0 ? (
              <View style={styles.dividerRow}>
                <Divider />
              </View>
            ) : null}
            <Pressable
              onPress={action.onPress}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              style={styles.row}
              testID={`menu-action-${action.actionId}`}
            >
              <View style={styles.icon} importantForAccessibility="no">
                {action.icon}
              </View>
              <Text size="body-sm" tone={action.isDestructive ? 'urgent' : 'default'}>
                {action.label}
              </Text>
            </Pressable>
          </View>
        ))}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing(8), paddingTop: spacing(6), paddingBottom: spacing(14) },
  dividerRow: { paddingHorizontal: spacing(6), paddingVertical: spacing(4) },
  row: {
    minHeight: ROW_HEIGHT,
    borderRadius: radius.control,
    paddingHorizontal: spacing(12),
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(11),
  },
  icon: { width: 16, alignItems: 'center' },
});
