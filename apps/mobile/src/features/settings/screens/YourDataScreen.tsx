// `account-lifecycle/11` — Settings → Your data. Built to `/design`'s
// Option B ("dedicated screen, calm status"): a Liquid Glass nav bar
// (DS§12.1), a progress ring while building, an explanatory card, and
// history below. Every section here answers this task's own Boundaries
// table — the explanatory copy and the request button never depend on a
// query; only the active-export card and the history list can fail
// independently, and each has its own shaped fallback.
import { GlassSurface, Button, Pressable, colors, radius, spacing } from '@coachos/ui';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { useExport, type ExportItem } from '../hooks/useExport.ts';

export interface YourDataScreenProps {
  onBack: () => void;
}

const NAV_BAR_HEIGHT = 56;

function BackChevron() {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M15 5l-7 7 7 7"
        stroke={colors.fg.DEFAULT}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const RING_RADIUS = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Real progress, never a spinner (Approach step 6, this task's own
 * Risks section) — the arc length is `percent`, not an indeterminate
 * animation. `accessibilityRole="progressbar"` carries the same number to
 * VoiceOver/TalkBack (`accessibility` skill §2's "Progress ring" row).
 */
function ProgressRing({ percent }: { percent: number }) {
  const offset = RING_CIRCUMFERENCE * (1 - percent / 100);
  return (
    <View
      style={styles.ringWrap}
      accessibilityRole="progressbar"
      accessibilityLabel="Export progress"
      accessibilityValue={{ min: 0, max: 100, now: percent }}
    >
      <Svg width={120} height={120} viewBox="0 0 120 120">
        <Circle
          cx={60}
          cy={60}
          r={RING_RADIUS}
          stroke={colors.border.soft}
          strokeWidth={8}
          fill="none"
        />
        <Circle
          cx={60}
          cy={60}
          r={RING_RADIUS}
          stroke={colors.brand.DEFAULT}
          strokeWidth={8}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform="rotate(-90 60 60)"
        />
      </Svg>
      <View style={styles.ringCenter} pointerEvents="none">
        <Text style={styles.ringPercent}>{percent}%</Text>
      </View>
    </View>
  );
}

/** Days remaining, rounded up — a countdown, not a calendar-day computation (`code-conventions` §6 governs the latter, not this). */
function daysRemaining(expiresAt: string | Date | null): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

function formatBytes(bytes: number | null): string | null {
  if (bytes === null) return null;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRowDate(createdAt: string | Date): string {
  return new Date(createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface ExportRowProps {
  item: ExportItem;
  onDownload: () => void;
}

/**
 * A row per past export. Expired rows are a documented 7-day rule, not an
 * error (this task's own States table) — greyed text, no icon, and a tap
 * explains why instead of doing nothing silently.
 */
function ExportRow({ item, onDownload }: ExportRowProps) {
  const expired = item.status === 'expired';
  const ready = item.status === 'ready';
  const days = daysRemaining(item.expiresAt);
  const size = formatBytes(item.bytes);

  const label =
    item.status === 'ready'
      ? `Ready${size ? ` · ${size}` : ''}${days !== null ? ` · expires in ${days} day${days === 1 ? '' : 's'}` : ''}`
      : item.status === 'expired'
        ? 'Expired'
        : item.status === 'failed'
          ? 'Failed'
          : item.status === 'building'
            ? 'Building'
            : 'Queued';

  return (
    <Pressable
      onPress={ready ? onDownload : undefined}
      accessibilityRole={ready ? 'button' : 'text'}
      accessibilityLabel={`${formatRowDate(item.createdAt)}, ${label}${expired ? '. Exports are available for 7 days after they are ready.' : ''}`}
      style={styles.row}
    >
      <Text style={[styles.rowDate, expired && styles.rowMuted]}>
        {formatRowDate(item.createdAt)}
      </Text>
      <View style={styles.rowRight}>
        <Text style={[styles.rowStatus, expired && styles.rowMuted]}>{label}</Text>
        {ready ? (
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <Path
              d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14"
              stroke={colors.fg.muted}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        ) : null}
      </View>
    </Pressable>
  );
}

export function YourDataScreen({ onBack }: YourDataScreenProps) {
  const insets = useSafeAreaInsets();
  const { history, status, requestExport, download } = useExport();

  const building =
    status?.data && (status.data.status === 'queued' || status.data.status === 'building');
  const mostRecent = history.data?.items[0];
  const showFailedCard = !building && mostRecent?.status === 'failed';
  const rateLimited = requestExport.error?.data?.appCode === 'EXPORT_RATE_LIMITED';
  const rateLimitedDownloadTarget =
    rateLimited && mostRecent?.status === 'ready' ? mostRecent : undefined;

  // Announce state changes for screen-reader users (`accessibility` skill
  // §2) — a silent transition from "preparing" to "ready" is invisible to
  // VoiceOver/TalkBack.
  const lastAnnouncedStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const current = status?.data?.status;
    if (current === undefined || current === lastAnnouncedStatus.current) return;
    lastAnnouncedStatus.current = current;
    if (current === 'ready') {
      AccessibilityInfo.announceForAccessibility('Your export is ready to download.');
    } else if (current === 'failed') {
      AccessibilityInfo.announceForAccessibility("We couldn't build your export.");
    } else if (current === 'building') {
      AccessibilityInfo.announceForAccessibility('Preparing your export.');
    }
  }, [status?.data?.status]);

  return (
    <View style={styles.screen}>
      <GlassSurface
        tier="tier1"
        style={[styles.navBar, { paddingTop: insets.top, height: NAV_BAR_HEIGHT + insets.top }]}
      >
        <View style={styles.navBarContent}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={12}
            style={styles.backButton}
          >
            <BackChevron />
          </Pressable>
          <Text style={styles.navTitle}>Your data</Text>
        </View>
      </GlassSurface>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: NAV_BAR_HEIGHT + insets.top + 20, paddingBottom: 28 + insets.bottom },
        ]}
      >
        {/* Explanatory copy — no data dependency, always renders (Boundaries). */}
        <View style={styles.section}>
          <Text style={styles.body}>
            Everything you&apos;ve logged in CoachOS is yours. Download a copy any time.
          </Text>
          <Text style={styles.body}>
            Your export includes your workouts, meals, measurements, check-ins, messages, and the
            feedback your coach gave you.
          </Text>
          <Text style={styles.bodyMuted}>
            Photos are included. Videos are linked — the links work for 7 days.
          </Text>
        </View>

        {building && status?.data ? (
          <View style={styles.card}>
            <ProgressRing percent={status.data.progressPercent} />
            <Text style={styles.cardTitle}>Preparing your export&hellip;</Text>
            <Text style={styles.bodyMuted}>
              You can leave this screen — we&apos;ll email you when it&apos;s ready.
            </Text>
          </View>
        ) : null}

        {showFailedCard ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>We couldn&apos;t build your export. Try again.</Text>
          </View>
        ) : null}

        {rateLimited ? (
          <View style={styles.card}>
            <Text style={styles.body}>
              You can request a new export tomorrow. Your last one is still available
              {rateLimitedDownloadTarget?.expiresAt
                ? ` for ${daysRemaining(rateLimitedDownloadTarget.expiresAt)} more days.`
                : '.'}
            </Text>
            {rateLimitedDownloadTarget ? (
              <Button
                variant="secondary"
                onPress={() => void download(rateLimitedDownloadTarget.id)}
              >
                Download
              </Button>
            ) : null}
          </View>
        ) : null}

        {/* The request button never depends on a query (this task's own
            Boundaries rule) — its disabled state depends only on `building`,
            which is derived from `status`, the ONE query this button itself
            triggers the need for; a failed `history` fetch never blocks it. */}
        {!building ? (
          <Button
            variant="primary"
            fullWidth
            loading={requestExport.isPending}
            onPress={() => requestExport.mutate()}
            accessibilityLabel="Request export"
          >
            Request export
          </Button>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Previous exports</Text>
          {history.isError ? (
            <View style={styles.card}>
              <Text style={styles.bodyMuted}>Couldn&apos;t load previous exports.</Text>
              <Button variant="ghost" onPress={() => void history.refetch()}>
                Retry
              </Button>
            </View>
          ) : history.data && history.data.items.length === 0 ? (
            <Text style={styles.bodyMuted}>No exports yet.</Text>
          ) : (
            <View style={styles.card}>
              {history.data?.items.map((item, index) => (
                <View key={item.id} style={index > 0 ? styles.rowDivider : undefined}>
                  <ExportRow item={item} onDownload={() => void download(item.id)} />
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg.DEFAULT },
  navBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    justifyContent: 'flex-end',
  },
  navBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(12),
    paddingHorizontal: spacing(20),
    paddingBottom: spacing(12),
  },
  backButton: { minWidth: 48, minHeight: 48, alignItems: 'flex-start', justifyContent: 'center' },
  navTitle: { fontSize: 20, lineHeight: 28, fontWeight: '600', color: colors.fg.DEFAULT },
  content: { paddingHorizontal: spacing(20), gap: spacing(24) },
  section: { gap: spacing(12) },
  sectionLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.fg.muted,
  },
  body: { fontSize: 16, lineHeight: 24, color: colors.fg.DEFAULT },
  bodyMuted: { fontSize: 13, lineHeight: 18, color: colors.fg.muted },
  card: {
    backgroundColor: colors.bg.raised,
    borderWidth: 1,
    borderColor: colors.border.soft,
    borderRadius: radius.card,
    padding: spacing(20),
    gap: spacing(12),
    alignItems: 'center',
  },
  cardTitle: { fontSize: 16, lineHeight: 22, fontWeight: '600', color: colors.fg.DEFAULT },
  ringWrap: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center' },
  ringCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  ringPercent: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '600',
    color: colors.fg.DEFAULT,
    fontVariant: ['tabular-nums'],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingVertical: spacing(12),
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border.soft },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing(8) },
  rowDate: { fontSize: 15, lineHeight: 20, color: colors.fg.DEFAULT },
  rowStatus: { fontSize: 13, lineHeight: 18, color: colors.fg.muted },
  rowMuted: { color: colors.fg.subtle },
});
