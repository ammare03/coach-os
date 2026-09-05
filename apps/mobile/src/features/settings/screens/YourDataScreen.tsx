// `account-lifecycle/11` — Settings → Your data. Built to `/design`'s
// Option B ("dedicated screen, calm status"): a Liquid Glass nav bar
// (DS§12.1), a progress ring while building, an explanatory card, and
// history below. Every section here answers this task's own Boundaries
// table — the explanatory copy and the request button never depend on a
// query; only the active-export card and the history list can fail
// independently, and each has its own shaped fallback.
import {
  GlassSurface,
  Button,
  Pressable,
  createThemedStyles,
  radius,
  spacing,
  useTheme,
} from '@coachos/ui';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { useExport, type ExportItem } from '../hooks/useExport.ts';

export interface YourDataScreenProps {
  onBack: () => void;
}

const NAV_BAR_HEIGHT = 56;

function BackChevron({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M15 5l-7 7 7 7"
        stroke={color}
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
  const theme = useTheme();
  const themed = useThemedStyles();
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
          stroke={theme.colors.border.soft}
          strokeWidth={8}
          fill="none"
        />
        <Circle
          cx={60}
          cy={60}
          r={RING_RADIUS}
          stroke={theme.colors.brand.DEFAULT}
          strokeWidth={8}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform="rotate(-90 60 60)"
        />
      </Svg>
      <View style={styles.ringCenter} pointerEvents="none">
        <Text style={[styles.ringPercent, themed.ringPercent]}>{percent}%</Text>
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
  const theme = useTheme();
  const themed = useThemedStyles();
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
      <Text style={[styles.rowDate, themed.rowDate, expired && themed.rowMuted]}>
        {formatRowDate(item.createdAt)}
      </Text>
      <View style={styles.rowRight}>
        <Text style={[styles.rowStatus, themed.rowStatus, expired && themed.rowMuted]}>
          {label}
        </Text>
        {ready ? (
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <Path
              d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14"
              stroke={theme.colors.fg.muted}
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
  const theme = useTheme();
  const themed = useThemedStyles();
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
    <View style={[styles.screen, themed.screen]}>
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
            <BackChevron color={theme.colors.fg.DEFAULT} />
          </Pressable>
          <Text style={[styles.navTitle, themed.navTitle]}>Your data</Text>
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
          <Text style={[styles.body, themed.body]}>
            Everything you&apos;ve logged in CoachOS is yours. Download a copy any time.
          </Text>
          <Text style={[styles.body, themed.body]}>
            Your export includes your workouts, meals, measurements, check-ins, messages, and the
            feedback your coach gave you.
          </Text>
          <Text style={[styles.bodyMuted, themed.bodyMuted]}>
            Photos are included. Videos are linked — the links work for 7 days.
          </Text>
        </View>

        {building && status?.data ? (
          <View style={[styles.card, themed.card]}>
            <ProgressRing percent={status.data.progressPercent} />
            <Text style={[styles.cardTitle, themed.cardTitle]}>Preparing your export&hellip;</Text>
            <Text style={[styles.bodyMuted, themed.bodyMuted]}>
              You can leave this screen — we&apos;ll email you when it&apos;s ready.
            </Text>
          </View>
        ) : null}

        {showFailedCard ? (
          <View style={[styles.card, themed.card]}>
            <Text style={[styles.cardTitle, themed.cardTitle]}>
              We couldn&apos;t build your export. Try again.
            </Text>
          </View>
        ) : null}

        {rateLimited ? (
          <View style={[styles.card, themed.card]}>
            <Text style={[styles.body, themed.body]}>
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
          <Text style={[styles.sectionLabel, themed.sectionLabel]}>Previous exports</Text>
          {history.isError ? (
            <View style={[styles.card, themed.card]}>
              <Text style={[styles.bodyMuted, themed.bodyMuted]}>
                Couldn&apos;t load previous exports.
              </Text>
              <Button variant="ghost" onPress={() => void history.refetch()}>
                Retry
              </Button>
            </View>
          ) : history.data && history.data.items.length === 0 ? (
            <Text style={[styles.bodyMuted, themed.bodyMuted]}>No exports yet.</Text>
          ) : (
            <View style={[styles.card, themed.card]}>
              {history.data?.items.map((item, index) => (
                <View
                  key={item.id}
                  style={index > 0 ? [styles.rowDivider, themed.rowDivider] : undefined}
                >
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

// Scheme-invariant geometry at module scope; every colour through the hook.
// Reading `colors` at module scope bakes the dark table in at import, so the
// screen can never follow a scheme change (`createThemedStyles`' contract).
const styles = StyleSheet.create({
  screen: { flex: 1 },
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
  navTitle: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
  content: { paddingHorizontal: spacing(20), gap: spacing(24) },
  section: { gap: spacing(12) },
  sectionLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  body: { fontSize: 16, lineHeight: 24 },
  bodyMuted: { fontSize: 13, lineHeight: 18 },
  card: {
    borderWidth: 1,
    borderRadius: radius.card,
    padding: spacing(20),
    gap: spacing(12),
    alignItems: 'center',
  },
  cardTitle: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  ringWrap: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center' },
  ringCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  ringPercent: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingVertical: spacing(12),
  },
  rowDivider: { borderTopWidth: 1 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing(8) },
  rowDate: { fontSize: 15, lineHeight: 20 },
  rowStatus: { fontSize: 13, lineHeight: 18 },
});

const useThemedStyles = createThemedStyles((theme) => ({
  screen: { backgroundColor: theme.colors.bg.DEFAULT },
  navTitle: { color: theme.colors.fg.DEFAULT },
  sectionLabel: { color: theme.colors.fg.muted },
  body: { color: theme.colors.fg.DEFAULT },
  bodyMuted: { color: theme.colors.fg.muted },
  card: {
    backgroundColor: theme.colors.bg.raised,
    borderColor: theme.colors.border.soft,
  },
  cardTitle: { color: theme.colors.fg.DEFAULT },
  ringPercent: { color: theme.colors.fg.DEFAULT },
  rowDivider: { borderTopColor: theme.colors.border.soft },
  rowDate: { color: theme.colors.fg.DEFAULT },
  rowStatus: { color: theme.colors.fg.muted },
  // An expired row dims to `fg.muted`, not `fg.subtle`: both call sites are
  // 13px and 15px, and DESIGN.md §13 restricts `fg.subtle` to >=14px — on a
  // raised card it measures 2.90:1 against `fg.muted`'s 6.41:1.
  rowMuted: { color: theme.colors.fg.muted },
}));
