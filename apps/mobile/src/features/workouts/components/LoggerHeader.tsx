import { GlassSurface, Pressable, Skeleton, Text } from '@coachos/ui';
import { createThemedStyles, radius, spacing, useTheme, withAlpha } from '@coachos/ui/theme';
import { ArrowLeft, Pause } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import type { LoggerSessionState } from '../hooks/useLoggerSession.ts';

import { SessionElapsed } from './SessionElapsed.tsx';

// The logger's whole chrome (`CoachOS-Client.dc.html`, the logger overlay's
// top bar; `DESIGN.md` §4 tier 2, §9's screen header). Three slots on one
// Tier-2 glass bar: the way out, what this session is, and how long it has
// been running.
//
// **Every slot degrades on its own**, which is most of what this file is.
// The header renders in all four of the shell's states, including the two
// where nothing is known about the session, and none of them may produce a
// half-filled bar: the name falls back to one neutral word, the sub-line
// and the clock drop out entirely rather than rendering `— of —` or
// `0:00`, and the exit control keeps working throughout.
//
// Glass appears exactly ONCE on this screen and it is here. The exit pill
// inside it is a plain translucent fill, not a `GlassSurface` — `DESIGN.md`
// §4's "never nest glass inside glass", and the prototype draws it the same
// way.

export interface LoggerHeaderProps {
  state: LoggerSessionState;
  /** Pauses the session and leaves. Never depends on `state` — see `loggerExitAction`. */
  onExit: () => void;
  /** Freezes the elapsed clock. Injected so it is testable; never passed in the app. */
  now?: Date | undefined;
}

/**
 * The session's name, or the one word that is true of every session this
 * route can open.
 *
 * `null` while the read is in flight: a title that appeared and then
 * changed under the client's eye is worse than one that arrives once, so
 * the slot holds a skeleton instead (`UI-UX.md` §UX4).
 */
export function loggerTitle(state: LoggerSessionState): string | null {
  if (state.kind === 'loading') return null;
  if (state.kind !== 'session') return FALLBACK_TITLE;
  return state.session.name ?? FALLBACK_TITLE;
}

/**
 * "8 of 22 sets" · "3 sets logged" · "No sets logged yet" · nothing.
 *
 * Facts, never a percentage and never a ratio against a denominator that
 * does not exist (`DESIGN.md` §10.3, `COPY.md` CO§2's no-shame rule — this
 * line counts what happened, it does not grade it).
 */
export function loggerSubtitle(state: LoggerSessionState): string | null {
  if (state.kind !== 'session') return null;

  const { setsLogged, targetSets } = state.session;
  if (targetSets > 0) return `${String(setsLogged)} of ${String(targetSets)} sets`;
  if (setsLogged > 0) return `${String(setsLogged)} sets logged`;
  return 'No sets logged yet';
}

export interface LoggerExitAction {
  label: 'Pause' | 'Back';
  accessibilityLabel: string;
}

/**
 * What the one way out is called.
 *
 * **"Pause", not a confirm dialog.** `ui-conventions` §5 prefers undo over
 * confirm, and there is nothing here to undo: leaving the logger writes
 * nothing, the row stays `in_progress` in local SQLite, and Today offers
 * "Continue" the moment the client lands back on it. The word is what
 * carries that — a dialog asking "are you sure?" gets dismissed reflexively
 * and teaches the client nothing about whether their work survived.
 *
 * **"Back" when there is no session to pause.** Error, not-found, and a
 * session that was never started all hold nothing pausable, and "Pause"
 * there would be a lie. Loading keeps "Pause" deliberately: arriving here
 * at all means a session was just started, so the optimistic label is right
 * in every path except the two that fail — and it never flips under a thumb
 * mid-set.
 */
export function loggerExitAction(state: LoggerSessionState): LoggerExitAction {
  const pausable =
    state.kind === 'loading' || (state.kind === 'session' && state.session.isInProgress);
  return pausable
    ? { label: 'Pause', accessibilityLabel: 'Pause workout and go back' }
    : { label: 'Back', accessibilityLabel: 'Go back' };
}

/** True of an assigned session, an ad-hoc one, and a session that failed to load. */
const FALLBACK_TITLE = 'Workout';

/** §9's screen-header geometry: the prototype's own bar draws at 22, which is `radius.section`. */
const BAR_RADIUS = radius.section;
const TITLE_SKELETON_WIDTH = 88;
const TITLE_SKELETON_HEIGHT = 15;
const SUBLINE_SKELETON_WIDTH = 124;
const SUBLINE_SKELETON_HEIGHT = 11;
/** The elapsed slot's width, reserved so the bar does not shift as digits arrive. */
const CLOCK_MIN_WIDTH = 54;
const ICON_SIZE = 15;
/**
 * `ui-conventions` §5's floor, not `tapTarget.MIN`'s 44. The two disagree —
 * `DESIGN.md` §13 says 44 everywhere and 52 for anything used mid-set — and
 * this control is pressed mid-set with chalked hands, so it takes the
 * larger of the two general floors. The prototype's 38px circle clears
 * neither.
 */
const EXIT_MIN_HEIGHT = 48;

export function LoggerHeader({ state, onExit, now }: LoggerHeaderProps) {
  const themed = useThemedStyles();
  const { colors } = useTheme();
  const title = loggerTitle(state);
  const subtitle = loggerSubtitle(state);
  const exit = loggerExitAction(state);
  const startedAt = state.kind === 'session' ? state.session.startedAt : null;
  const ExitIcon = exit.label === 'Pause' ? Pause : ArrowLeft;

  return (
    <GlassSurface tier="tier2" style={[styles.bar, { borderRadius: BAR_RADIUS }]}>
      <Pressable
        onPress={onExit}
        accessibilityRole="button"
        accessibilityLabel={exit.accessibilityLabel}
        style={[styles.exit, themed.exit]}
        testID="logger-exit"
      >
        {/* Icon plus word, never a bare glyph: `DESIGN.md` §13, "an icon
            never travels alone in navigation". It is also the only thing
            that tells the client the session survives the tap. */}
        <ExitIcon size={ICON_SIZE} color={colors.fg.glass} strokeWidth={2.4} />
        <Text size="label" tone="glass">
          {exit.label}
        </Text>
      </Pressable>

      <View style={styles.words}>
        {title === null ? (
          <Skeleton
            width={TITLE_SKELETON_WIDTH}
            height={TITLE_SKELETON_HEIGHT}
            radius="chip"
            accessibilityLabel="Loading this workout"
          />
        ) : (
          // No `numberOfLines`: at 200% text a long day name wraps and the
          // bar grows with it rather than clipping (`accessibility` §3 —
          // min-height, never height).
          <Text size="label" tone="glass" accessibilityRole="header" style={styles.centred}>
            {title}
          </Text>
        )}
        {subtitle === null ? (
          title === null ? (
            <Skeleton
              width={SUBLINE_SKELETON_WIDTH}
              height={SUBLINE_SKELETON_HEIGHT}
              radius="chip"
              style={styles.subLine}
            />
          ) : null
        ) : (
          <Text
            size="micro"
            tone="warm-muted"
            style={[styles.centred, styles.subLine, styles.tabular]}
          >
            {subtitle}
          </Text>
        )}
      </View>

      <View style={styles.clock}>
        {startedAt === null ? null : <SessionElapsed startedAt={startedAt} now={now} />}
      </View>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(10),
    // The prototype's own inset from the device edge, and its padding.
    marginHorizontal: spacing(14),
    marginBottom: spacing(10),
    paddingVertical: spacing(8),
    paddingLeft: spacing(8),
    paddingRight: spacing(10),
  },
  exit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(7),
    // `minHeight`, never `height` — the floor is a floor, and at 200% text
    // the label needs the room to push past it (`accessibility` §3).
    minHeight: EXIT_MIN_HEIGHT,
    paddingHorizontal: spacing(14),
    borderRadius: EXIT_MIN_HEIGHT / 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  words: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  centred: {
    textAlign: 'center',
  },
  subLine: {
    marginTop: spacing(3),
  },
  tabular: {
    // The sub-line counts sets, and digits must not jitter as they change.
    fontVariant: ['tabular-nums'],
  },
  clock: {
    minWidth: CLOCK_MIN_WIDTH,
    alignItems: 'flex-end',
  },
});

const useThemedStyles = createThemedStyles(({ colors }) => ({
  exit: {
    backgroundColor: withAlpha(colors.bg.inset, '0.45'),
    borderColor: withAlpha(colors.fg.glass, '0.14'),
  },
}));
