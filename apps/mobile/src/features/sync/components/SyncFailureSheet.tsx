import {
  Button,
  Card,
  createThemedStyles,
  Metric,
  Sheet,
  SheetHeader,
  spacing,
  Text,
  useTheme,
} from '@coachos/ui';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { FailedOutboxSummary } from '../../../lib/outbox/failed-entries.ts';
import { formatQueuedAt } from '../queued-at.ts';

import { syncFailureTitle } from './SyncFailureBanner.tsx';

// The approved design's frame C — what is stuck, and the manual retry.
// Design approved by Ammar; do not redesign this.
//
// Two surfaces rather than one because `ERRORS.md` ER§1.4 gives
// `SYNC_PERMANENTLY_FAILED` the action "Review" and the task text says
// "Retry": the banner row IS the review tap, and "Try again" is the primary
// button in here. Both stay true.
//
// **No delete.** DB§14.4 forbids dropping an entry, and a bin would be the
// same loss with the user's consent attached to it.

const BODY =
  'These are still on this device. Nothing is lost — they just haven’t reached your account.';
const FOOTNOTE = 'They’ll stay on this device until they save.';
const RETRY_LABEL = 'Try again';

export type SyncFailureSheetProps = {
  isOpen: boolean;
  onDismiss: () => void;
  summary: FailedOutboxSummary;
  /** True while the retry's flush is in flight — the button holds its width and shows a spinner. */
  isRetrying: boolean;
  onRetry: () => void;
  /**
   * Injected so the day boundary is testable (`formatQueuedAt`). Omitted
   * in the app, where it is read once when the sheet mounts — a row that
   * flipped from "Today" to "Yesterday" mid-render would be a re-render
   * artefact, not news.
   */
  nowMs?: number;
};

export function SyncFailureSheet({
  isOpen,
  onDismiss,
  summary,
  isRetrying,
  onRetry,
  nowMs,
}: SyncFailureSheetProps) {
  const themed = useThemedStyles();
  const theme = useTheme();
  // A lazy `useState` initialiser is where React sanctions reading a clock;
  // calling `Date.now()` in the render body is not (`react-hooks/purity`).
  const [mountedAt] = useState(() => Date.now());
  const readAt = nowMs ?? mountedAt;

  return (
    <Sheet isOpen={isOpen} onDismiss={onDismiss} snap="auto" testID="sync-failure-sheet">
      <SheetHeader title={syncFailureTitle(summary.totalCount)} onClose={onDismiss} />
      <View style={styles.body}>
        <Text size="body" tone="warm-muted">
          {BODY}
        </Text>

        <Card elevation="inset" density="client">
          {summary.groups.map((group, index) => (
            <View
              key={group.procedure}
              style={[styles.row, index > 0 && themed.rowDivider]}
              accessibilityRole="summary"
              accessibilityLabel={`${group.label}, ${group.count}, queued ${formatQueuedAt(group.lastQueuedAt, readAt)}`}
            >
              <View style={[styles.dot, { backgroundColor: theme.colors.brand.DEFAULT }]} />
              <View style={styles.rowText}>
                <Text size="label">{group.label}</Text>
                <Text size="micro" tone="muted">
                  {formatQueuedAt(group.lastQueuedAt, readAt)}
                </Text>
              </View>
              <Metric value={group.count} size="numeral" tone="warm" />
            </View>
          ))}
        </Card>

        <Button
          size="lg"
          fullWidth
          onPress={onRetry}
          loading={isRetrying}
          accessibilityLabel={RETRY_LABEL}
        >
          {RETRY_LABEL}
        </Button>
        <Text size="caption" tone="muted" style={styles.footnote}>
          {FOOTNOTE}
        </Text>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: spacing(20),
    paddingTop: spacing(11),
    paddingBottom: spacing(26),
    gap: spacing(14),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(10),
    minHeight: 44,
  },
  rowText: {
    flex: 1,
    gap: spacing(3),
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    flexShrink: 0,
  },
  footnote: {
    textAlign: 'center',
  },
});

const useThemedStyles = createThemedStyles((theme) => ({
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border.soft,
  },
}));
