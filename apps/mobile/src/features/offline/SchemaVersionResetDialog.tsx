// `local-database/04` — the one user-facing surface a schema-version
// mismatch can produce (`offline-sync` skill §8: an unsynced outbox can't
// just be discarded). Design approved by Ammar; do not redesign this —
// see the task's Copy section for the exact strings below.
import { Button, Card, createThemedStyles, Modal, spacing, Text, useTheme } from '@coachos/ui';
import { AlertTriangle } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import type { OutboxGroupCount } from '../../db/schema-version.ts';

export type SchemaVersionResetDialogProps = {
  isOpen: boolean;
  /**
   * `null` means the outbox itself could not be read to produce a count
   * (the severe-mismatch case) — never a guessed number, never a claimed
   * zero.
   */
  counts: OutboxGroupCount[] | null;
  isClearing: boolean;
  onConfirm: () => void;
};

function pluralizeEntries(total: number): string {
  return total === 1
    ? '1 offline entry will be cleared'
    : `${total} offline entries will be cleared`;
}

/**
 * The blocking dialog for `checkSchemaVersion()`'s "confirm required"
 * outcome. `Modal`, never `ConfirmModal` — there is nothing to type and
 * exactly one way forward (`Modal`'s own header comment on a third
 * consumer being a design review, which this is). `isDismissible={false}`:
 * the app cannot run against an incompatible local schema, so there is no
 * "not now".
 */
export function SchemaVersionResetDialog({
  isOpen,
  counts,
  isClearing,
  onConfirm,
}: SchemaVersionResetDialogProps) {
  const theme = useTheme();
  const themed = useThemedStyles();

  if (isClearing) {
    return (
      <Modal
        isOpen={isOpen}
        onDismiss={doNothing}
        isDismissible={false}
        testID="schema-version-reset-dialog"
      >
        <View style={styles.clearingRow} accessibilityLiveRegion="polite" accessibilityRole="alert">
          <ActivityIndicator color={theme.colors.brand.DEFAULT} size="small" />
          <Text size="body">Clearing offline data…</Text>
        </View>
      </Modal>
    );
  }

  const total = counts === null ? null : counts.reduce((sum, group) => sum + group.count, 0);
  const title = total === null ? 'Offline entries will be cleared' : pluralizeEntries(total);
  const body =
    counts === null
      ? 'This version of CoachOS stores data differently on your device. Anything logged offline that never reached your account will be cleared.'
      : 'This version of CoachOS stores data differently on your device. These entries never reached your account, and resetting clears them.';

  return (
    <Modal
      isOpen={isOpen}
      onDismiss={doNothing}
      isDismissible={false}
      testID="schema-version-reset-dialog"
    >
      <View
        style={[styles.iconWell, themed.iconWell]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <AlertTriangle size={19} color={theme.colors.brand.DEFAULT} />
      </View>
      <Text size="title" accessibilityRole="header">
        {title}
      </Text>
      <Text size="body" tone="muted">
        {body}
      </Text>
      {counts !== null && counts.length > 0 ? (
        <Card elevation="inset" density="client">
          {counts.map((group, index) => (
            <View
              key={group.procedure}
              style={[styles.countsRow, index > 0 && themed.countsRowDivider]}
            >
              <Text size="body-sm" tone="muted">
                {group.label}
              </Text>
              <Text size="label">{group.count}</Text>
            </View>
          ))}
        </Card>
      ) : null}
      <Button size="lg" fullWidth onPress={onConfirm} accessibilityLabel="Clear and continue">
        Clear and continue
      </Button>
      <Text size="caption" tone="muted" style={styles.caption}>
        Anything already saved to your account is unaffected.
      </Text>
    </Modal>
  );
}

// `isDismissible={false}` means `Modal` never calls `onDismiss` — it is a
// required prop with nothing for this dialog to do on dismissal.
function doNothing(): void {
  // Intentionally empty.
}

const styles = StyleSheet.create({
  iconWell: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing(6),
  },
  caption: {
    textAlign: 'center',
  },
  clearingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(10),
  },
});

const useThemedStyles = createThemedStyles((theme) => ({
  iconWell: { ...theme.elevation.inset },
  countsRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border.soft,
  },
}));
