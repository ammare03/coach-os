import {
  Card,
  Pressable,
  Text,
  createThemedStyles,
  createThemedValue,
  density,
  duration,
  easing,
  radius,
  spacing,
} from '@coachos/ui';
import { formatLocalDate } from '@coachos/utils';
import { LinearGradient } from 'expo-linear-gradient';
import { Pencil, Pin, Trash2 } from 'lucide-react-native';
import { memo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';

import type { CoachClientNote } from '../api.ts';

// One private note, two tiers: the prose gets the whole content channel and
// the three controls get their own line under it. A one-tier row would
// leave the body ~215px of a 355px channel, and a 70-character note is one
// line at 355 and three at 215 — so the "taller" layout is the shorter one
// for real note lengths.
//
// **Handlers only.** No `clientId`, no mutation, and no `isEditing`: the
// row does not know it is optimistic, which is what lets the route own the
// rollback, and the screen swaps the row for the composer rather than the
// row growing a second identity.

const CARD_PADDING_H = density.coach.cardPadding; // 14
const CARD_PADDING_V = spacing(13);
const BORDER = 1;
/** `body`'s own lineHeight (`fontSize.body` = 15/22), which sets the one-line floor. */
const BODY_LINE = 22;
const BODY_META_GAP = spacing(9);

/** 32 box, 48 target. `radius.card` is 16, which is exactly half of 32. */
const DISC_SIZE = 32;
const GLYPH_SIZE = 15;
const GLYPH_STROKE = 2;

/**
 * `ceil((48 − 32) / 2)`. The floor `accessibility` §1 asks for, bought with
 * slop rather than by growing the box past what the meta line holds.
 */
const DISC_SLOP = 8;
const DISC_HIT_SLOP = {
  top: DISC_SLOP,
  bottom: DISC_SLOP,
  left: DISC_SLOP,
  right: DISC_SLOP,
} as const;

/**
 * **16, not 10.** Each disc buys its 48×48 with `hitSlop: 8` on all four
 * sides; at gap 10 two adjacent slops overlap by 6px and the wrong control
 * fires. 16 is the smallest step on the `DESIGN.md` §1.4 scale that clears
 * 8 + 8.
 */
const DISC_GAP = spacing(16);

/** The gap to the next row. Inside the row's own footprint, so the recycler measures it. */
export const NOTE_ROW_GAP = spacing(9);

/**
 * **`1 + 13 + 22 + 9 + 32 + 13 + 1` = 91 — and it is a `minHeight`, never a
 * `height`.**
 *
 * FlashList v2 deleted `estimatedItemSize` (`CLAUDE.md` §25.8): its
 * recycler measures rows itself, so reporting a stable size on the first
 * layout pass is the row's own job. At 200% text the body wraps and the row
 * grows past this — which is the whole reason it is a floor
 * (`accessibility` §3). Derived from the tokens rather than written as 91,
 * so a change to either moves it instead of silently invalidating it; the
 * row's own test pins the arithmetic.
 */
export const NOTE_CARD_MIN_HEIGHT =
  BORDER * 2 + CARD_PADDING_V * 2 + BODY_LINE + BODY_META_GAP + DISC_SIZE;

/** What the list reserves per item: the card plus the gap under it. */
export const NOTE_ROW_MIN_HEIGHT = NOTE_CARD_MIN_HEIGHT + NOTE_ROW_GAP;

/**
 * Above this OS font scale the meta line stacks instead of sitting in one
 * row. At 200% the date is ~230px wide and the three discs are 128; 230 +
 * 12 + 128 overruns the 355px channel, so they would collide. The discs
 * themselves never scale — a tap target is already at its floor.
 */
const STACK_META_ABOVE_FONT_SCALE = 1.5;

const PIN_EASING = Easing.bezier(easing.out[0], easing.out[1], easing.out[2], easing.out[3]);

export const PIN_ON_LABEL = 'Unpin this note';
export const PIN_OFF_LABEL = 'Pin this note';
export const PIN_ON_HINT = 'Removes it from the Overview tab';
export const PIN_OFF_HINT = 'Pinned notes appear on the Overview tab';
export const EDIT_LABEL = 'Edit this note';
export const DELETE_LABEL = 'Delete this note';
export const DELETE_HINT = 'You will have five seconds to undo';

export interface NoteRowProps {
  note: CoachClientNote;
  /** Takes the state it is moving TO, never a toggle — `notes.setPinned`'s own contract. */
  onTogglePin: (next: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  /** Injected by tests only; the row reads the clock otherwise. */
  now?: Date;
  testID?: string;
}

export const NoteRow = memo(function NoteRow({
  note,
  onTogglePin,
  onEdit,
  onDelete,
  now,
  testID,
}: NoteRowProps) {
  const themed = useThemedStyles();
  const palette = useDiscPalette();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= STACK_META_ABOVE_FONT_SCALE;

  const at = now ?? new Date();

  return (
    <View style={styles.row} testID={testID ?? `note-row-${note.noteId}`}>
      {/* L2, even when pinned: `DESIGN.md` §2 reserves L3 for *needs
          attention*, and a pinned note is a preference, not an alert. The
          card owns the surface; the padding is this row's, because 13/14 is
          not `density.coach.cardPadding` on both axes. */}
      <Card elevation="raised" density="coach" padded={false}>
        <View style={styles.inner}>
          {/* One sentence per note, not five fragments — and the date is
              inside it rather than a second stop in the reading order
              (`accessibility` §2). Never clamped: a note a coach cannot
              finish reading is a note they have to open to read. */}
          <View accessible accessibilityRole="summary" accessibilityLabel={describeNote(note, at)}>
            <Text size="body">{note.body}</Text>
          </View>

          <View style={[styles.meta, stacked ? styles.metaStacked : null]}>
            <Text
              size="caption"
              tone="muted"
              style={styles.date}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {formatNoteMeta(note, at)}
            </Text>
            {stacked ? null : <View style={styles.spacer} />}

            <View style={[styles.discs, stacked ? styles.discsStacked : null]}>
              <Pressable
                onPress={() => {
                  onTogglePin(!note.isPinned);
                }}
                hitSlop={DISC_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel={note.isPinned ? PIN_ON_LABEL : PIN_OFF_LABEL}
                // Where the pin SENDS the note. The one person who cannot
                // see the group header is the one told outright.
                accessibilityHint={note.isPinned ? PIN_ON_HINT : PIN_OFF_HINT}
                accessibilityState={{ selected: note.isPinned }}
                testID={`note-pin-${note.noteId}`}
              >
                <PinDisc pinned={note.isPinned} />
              </Pressable>

              <Pressable
                onPress={onEdit}
                hitSlop={DISC_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel={EDIT_LABEL}
                testID={`note-edit-${note.noteId}`}
              >
                <View style={[styles.disc, themed.disc]}>
                  <Pencil size={GLYPH_SIZE} strokeWidth={GLYPH_STROKE} color={palette.muted} />
                </View>
              </Pressable>

              <Pressable
                onPress={onDelete}
                hitSlop={DISC_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel={DELETE_LABEL}
                accessibilityHint={DELETE_HINT}
                testID={`note-delete-${note.noteId}`}
              >
                {/* Neutral at rest, and neutral on press too — a DECLARED
                    deviation from the design's `#FF8A9B` press tint.
                    `urgent-text` is entitled to `Button`, `IconButton`,
                    `ListRow` and `Text` and to nothing else
                    (`eslint.react-native.js`'s allowlist, whose own comment
                    says the entitlement must not spread "a file per
                    feature"). What the colour was carrying is carried
                    anyway: the trash glyph, the spoken "Delete this note ·
                    you will have five seconds to undo", and the five-second
                    window itself. */}
                <View style={[styles.disc, themed.disc]}>
                  <Trash2 size={GLYPH_SIZE} strokeWidth={GLYPH_STROKE} color={palette.muted} />
                </View>
              </Pressable>
            </View>
          </View>
        </View>
      </Card>
    </View>
  );
});

interface PinDiscProps {
  pinned: boolean;
}

/**
 * Pinned reads on **three** channels, so none is load-bearing alone: an L3
 * tint fill, a *filled* rather than outlined head, and brand ink. Greyscale
 * the screen and the solid head still says pinned (`accessibility` §4).
 *
 * The change cross-fades over `duration.state` and nothing else moves — a
 * pinned row travels from the bottom of a long list to the top, and
 * animating that is motion nobody can follow, so the row simply *is* in its
 * new place on the next commit. Under Reduce Motion this is already a
 * cross-fade, so there is nothing to collapse.
 */
function PinDisc({ pinned }: PinDiscProps) {
  const themed = useThemedStyles();
  const palette = useDiscPalette();

  const progress = useDerivedValue(
    () => withTiming(pinned ? 1 : 0, { duration: duration.state, easing: PIN_EASING }),
    [pinned],
  );

  const tintStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const outlineStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));
  const filledStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const borderStyle = useAnimatedStyle(() => ({
    borderColor: progress.value > 0.5 ? palette.tintedBorder : palette.border,
  }));

  return (
    <Animated.View style={[styles.disc, themed.disc, borderStyle]}>
      <Animated.View style={[StyleSheet.absoluteFill, tintStyle]} pointerEvents="none">
        <LinearGradient
          colors={palette.tint}
          start={GRADIENT_TOP}
          end={GRADIENT_BOTTOM}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Animated.View style={[styles.glyph, outlineStyle]} pointerEvents="none">
        <Pin size={GLYPH_SIZE} strokeWidth={GLYPH_STROKE} color={palette.muted} />
      </Animated.View>
      <Animated.View style={[styles.glyph, filledStyle]} pointerEvents="none">
        <Pin
          size={GLYPH_SIZE}
          strokeWidth={GLYPH_STROKE}
          color={palette.brand}
          fill={palette.brand}
          testID="note-pin-filled"
        />
      </Animated.View>
    </Animated.View>
  );
}

const GRADIENT_TOP = { x: 0, y: 0 } as const;
const GRADIENT_BOTTOM = { x: 0, y: 1 } as const;

/**
 * The coach wrote this note on this device, so the device's zone is their
 * zone — unlike a client's training day, which is read from the client's
 * stored `users.timezone` because the reader is somewhere else
 * (`CLAUDE.md` §25.5).
 */
function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const RECENT_DAYS = 7;
const MS_PER_DAY = 86_400_000;

/**
 * "Tuesday" inside a week, "2 Sep" beyond it, "2 Sep 2025" beyond a year —
 * `product-copy` §6's relative-then-absolute rule.
 */
export function formatNoteStamp(instant: Date, now: Date, timeZone = deviceTimeZone()): string {
  const elapsedMs = now.getTime() - instant.getTime();
  if (elapsedMs >= 0 && elapsedMs < RECENT_DAYS * MS_PER_DAY) {
    return formatLocalDate(instant, timeZone, 'EEEE');
  }
  const sameYear =
    formatLocalDate(instant, timeZone, 'yyyy') === formatLocalDate(now, timeZone, 'yyyy');
  return formatLocalDate(instant, timeZone, sameYear ? 'd MMM' : 'd MMM yyyy');
}

/**
 * Migration 0021's `touch_updated_at` trigger moves `updated_at` on every
 * write, so equality — not ordering — is what distinguishes an untouched
 * note from an edited one.
 */
function wasEdited(note: CoachClientNote): boolean {
  return note.updatedAt.getTime() !== note.createdAt.getTime();
}

/** "21 Aug · edited 2 Sep". An edited note names the edit; it does not hide it. */
export function formatNoteMeta(
  note: CoachClientNote,
  now: Date,
  timeZone = deviceTimeZone(),
): string {
  const written = formatNoteStamp(note.createdAt, now, timeZone);
  if (!wasEdited(note)) return written;
  return `${written} · edited ${formatNoteStamp(note.updatedAt, now, timeZone)}`;
}

/**
 * What a screen reader says: the note, then when it was written, in one
 * run. The body is a coach's own prose and usually ends in a full stop
 * already — a second one is a pause the sentence does not have.
 */
export function describeNote(
  note: CoachClientNote,
  _now: Date,
  timeZone = deviceTimeZone(),
): string {
  const stem = note.body.trimEnd();
  const lead = /[.!?]$/u.test(stem) ? stem : `${stem}.`;
  const written = `Written ${formatLocalDate(note.createdAt, timeZone, 'd MMMM')}.`;
  if (!wasEdited(note)) return `${lead} ${written}`;
  return `${lead} ${written} Edited ${formatLocalDate(note.updatedAt, timeZone, 'd MMMM')}.`;
}

const styles = StyleSheet.create({
  row: { paddingBottom: NOTE_ROW_GAP },
  inner: {
    minHeight: NOTE_CARD_MIN_HEIGHT - BORDER * 2,
    paddingVertical: CARD_PADDING_V,
    paddingHorizontal: CARD_PADDING_H,
  },
  meta: { marginTop: BODY_META_GAP, flexDirection: 'row', alignItems: 'center', gap: spacing(12) },
  metaStacked: { flexDirection: 'column', alignItems: 'flex-start', gap: spacing(9) },
  date: { fontVariant: ['tabular-nums'] },
  spacer: { flex: 1, minWidth: spacing(8) },
  discs: { flexDirection: 'row', alignItems: 'center', gap: DISC_GAP },
  discsStacked: { alignSelf: 'flex-end' },
  disc: {
    width: DISC_SIZE,
    height: DISC_SIZE,
    borderRadius: radius.card,
    borderWidth: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  glyph: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const useThemedStyles = createThemedStyles((t) => ({
  disc: {
    backgroundColor: t.elevation.inset.backgroundColor,
    borderColor: t.colors.border.strong,
  },
}));

/**
 * The glyph ink is `fg.muted`, not `fg.subtle`: these are live controls,
 * and `subtle`'s 3.1:1 clears the graphic floor by 0.1 — not a margin worth
 * taking on a delete (`accessibility` §4).
 *
 * **`brand` is scheme-invariant** (`tokens.ts`) and measures ~1.8:1 as ink
 * on a light tinted disc, so the pinned glyph walks `DESIGN.md` §1.1's warm
 * ramp down to `fg.warm` there instead. Not a token change — a substitution
 * this screen makes and names, exactly as the design's own light column
 * does.
 */
const useDiscPalette = createThemedValue((t) => ({
  muted: t.colors.fg.muted,
  brand: t.scheme === 'light' ? t.colors.fg.warm : t.colors.brand.DEFAULT,
  border: t.colors.border.strong,
  tintedBorder: t.colors.border.tinted,
  tint: t.elevation.tinted.gradient,
}));
