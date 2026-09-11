import { Card, IconButton, NumberStepper, Text, resolveButtonVariantVisuals } from '@coachos/ui';
import { density, spacing, useTheme } from '@coachos/ui/theme';
import { formatWeight, type WeightUnit } from '@coachos/utils';
import { Check } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

// `set-entry/01` — the composer. Two steppers and a confirm, pinned to the
// bottom of the slot, and the single most repeated interaction in the
// product.
//
// ============== THE ONE PROPERTY THIS FILE EXISTS TO HOLD ==============
//
// **The card is 205px, always.** Barbell or cable, history or none, set 1 or
// set 12. Four bands — head 33, weight 52, context 20, action 52 — plus
// three gaps (8, 4, 8) and 14px of padding either side. The list above
// gives way; the card never does.
//
// Which means the primary target of the most-repeated interaction in the
// product sits at THE SAME SCREEN COORDINATE for the whole session. A client
// between reps finds it without looking. **Any change that makes this height
// conditional gives that up**, and it is the most valuable property of this
// layout — including the obvious ones: do not hide the context band when it
// is empty (that is exactly why it renders at a fixed minimum with two empty
// slots), do not drop the head label, do not add a band.
//
// The one sanctioned exception is `set-entry/02`'s nearest-weight line,
// which takes the card to 229 and resolves in one tap.
//
// =======================================================================
//
// **Nothing here implies a network.** No spinner, no pending tint, no
// "saved" toast, and `IconButton`'s `loading` prop is forbidden on the
// confirm: the write is two local SQLite rows (`useLogSet`), so online and
// offline are the same code path and must look identical. `GlassSurface` is
// not used — `ui-conventions` §5 forbids glass on this surface.
//
// **There is no reachable validation failure.** `NumberStepper` clamps both
// values including the type-a-number path, so this card cannot hold an
// invalid input. No error state, and `hapticValidationFailure()` is never
// called here; the only haptic on this surface is `hapticSetLogged()`, once,
// on create, fired by the slot.

/**
 * Every word this control says, and the only place it says them
 * (`product-copy` §6; the same shape as `SessionFinish`'s `FINISH_COPY`).
 *
 * The interpolating members are functions rather than concatenations at the
 * call site, so a localiser moves the whole sentence and the numeral's
 * position within it.
 */
export const SET_ENTRY_COPY = {
  /** Rendered uppercase by the `eyebrow` token, not by the string. */
  setLabel: (setNumber: number) => `Set ${String(setNumber)}`,
  weightLabel: 'Weight',
  repsLabel: 'Reps',
  /** `Log set 3, 82.5 kilograms for 8 reps` — the whole sentence, §10.8's label. */
  confirmLabel: (setNumber: number, load: string) => `Log set ${String(setNumber)}, ${load}`,
  /** Announced on confirm, so an optimistic write is not silent to a screen reader. */
  loggedAnnouncement: (setNumber: number, load: string) =>
    `Set ${String(setNumber)} logged, ${load}`,
  /**
   * `ERRORS.md` ER§1.4's local-read failure, in this surface's voice, and
   * the only failure it has: `logSet` rejects solely when the device holds
   * no such session or the session is not in progress. Never a code, never
   * the raw error, and never phrased as a network problem — it is not one.
   */
  failed: 'Couldn’t log that set. Try again.',
} as const;

/** Task 05 adds `'edit'`; `'create'` is the only mode implemented here. */
export type SetEntryMode = 'create' | 'edit';

const CONFIRM_ICON_SIZE = 20;

/** Reps are 1–100, step 1 (design spec). The stepper clamps; nothing below can be invalid. */
const REPS_MIN = 1;
const REPS_MAX = 100;

/** 500kg / 1100lb — a ceiling in the unit the client reads, never a converted one. */
const WEIGHT_MAX: Record<WeightUnit, number> = { kg: 500, lb: 1100 };

export interface SetEntryRowProps {
  /**
   * Declared now so `set-entry/05` adds a branch rather than a signature.
   * Only `'create'` is implemented; the editor is an in-place expansion of
   * a logged row, not a second component.
   */
  mode?: SetEntryMode;
  /** 1-based, and already includes anything in flight — see `SetEntrySlot`. */
  setNumber: number;
  /** In the client's display unit. The slot converts at the edge, on confirm. */
  weight: number;
  reps: number;
  unit: WeightUnit;
  /** The stepper increment, native to `unit` — never a converted one. */
  weightStep: number;
  onWeightChange: (weight: number) => void;
  onRepsChange: (reps: number) => void;
  onConfirm: () => void;
  /**
   * **Seam — `set-entry/04`'s `SetFlagChips`.** The right of the head band.
   * The chips take ~191px of the card's 270, which is why the head label is
   * omitted for a warm-up rather than wrapped.
   */
  headTrailing?: ReactNode;
  /**
   * **Seam — `set-entry/02`'s `PlateStack`.** The left of the context band.
   */
  contextLeading?: ReactNode;
  /**
   * **Seam — `set-entry/03`'s `PreviousSetLine`.** The right of the context
   * band, including its "no set 4 last time" absent case.
   */
  contextTrailing?: ReactNode;
  testID?: string;
}

export function SetEntryRow({
  mode = 'create',
  setNumber,
  weight,
  reps,
  unit,
  weightStep,
  onWeightChange,
  onRepsChange,
  onConfirm,
  headTrailing,
  contextLeading,
  contextTrailing,
  testID,
}: SetEntryRowProps) {
  const theme = useTheme();
  // Kept in step with the variant rather than hardcoded, so a white-label
  // brand that needs dark ink on its primary does not get a white tick.
  const iconColor = resolveButtonVariantVisuals('primary', false, false, theme).textColor;
  const load = speakLoad(displayLoad(weight), reps, unit);

  return (
    // The wrapper, not the `Card`, carries `flexShrink: 0` — `Card` owns its
    // own surface and takes no style. This is what makes the list above
    // give way instead of the card compressing.
    <View style={styles.pinned} testID={testID}>
      {/* `density="coach"` is the 14px padding, not a role claim: 18 pushes
          the confirm out of the slot. */}
      <Card elevation="raised" density="coach">
        <View style={styles.head} testID="set-entry-head">
          {mode === 'edit' ? null : (
            <Text size="eyebrow" tone="muted" style={styles.upper}>
              {SET_ENTRY_COPY.setLabel(setNumber)}
            </Text>
          )}
          {/* Task 04's chips. Empty today, and the band still stands. */}
          {headTrailing}
        </View>

        <View style={styles.weight}>
          <NumberStepper
            value={weight}
            onChange={onWeightChange}
            step={weightStep}
            min={0}
            max={WEIGHT_MAX[unit]}
            unit={unit}
            // "82.5 kilograms", not "82.5 kg" — the spoken form
            // (`accessibility` §2). `NumberStepper` puts it on the
            // `adjustable`'s `accessibilityValue.text`.
            unitLabel={speakUnit(unit)}
            density="client"
            accessibilityLabel={SET_ENTRY_COPY.weightLabel}
            testID="set-entry-weight"
          />
        </View>

        {/* **Present in every variant, empty or not.** Both occupants arrive
            in later tasks; the band is what keeps the card at 205px when
            they do, and removing it when empty is the one change this
            layout cannot take. */}
        <View style={styles.context} testID="set-entry-context">
          <View style={styles.contextSlot}>{contextLeading}</View>
          <View style={styles.contextSlotEnd}>{contextTrailing}</View>
        </View>

        <View style={styles.action}>
          <View style={styles.reps}>
            <NumberStepper
              value={reps}
              onChange={onRepsChange}
              step={1}
              min={REPS_MIN}
              max={REPS_MAX}
              unit="reps"
              density="coach"
              accessibilityLabel={SET_ENTRY_COPY.repsLabel}
              testID="set-entry-reps"
            />
          </View>

          {/* The label §10.8 asks for is present and 8px away in the head;
              the screen reader gets the whole sentence. A labelled bar would
              cost a band the slot does not have.
              **Never `loading`** — there is nothing to wait for. */}
          <IconButton
            icon={<Check size={CONFIRM_ICON_SIZE} strokeWidth={2.8} color={iconColor} />}
            variant="primary"
            size="lg"
            onPress={onConfirm}
            accessibilityLabel={SET_ENTRY_COPY.confirmLabel(setNumber, load)}
            testID="set-entry-confirm"
          />
        </View>
      </Card>
    </View>
  );
}

/** `kilograms` · `pounds` — the spoken unit, never the glyph. */
export function speakUnit(unit: WeightUnit): string {
  return unit === 'kg' ? 'kilograms' : 'pounds';
}

/**
 * `82.5 kilograms for 8 reps` · `8 reps` for a bodyweight set.
 *
 * Glyphs expanded to words, because a screen reader reads `82.5kg × 8` as
 * something between "eighty two point five kg times eight" and nothing at
 * all — and this is the one screen where a misread is a client putting the
 * wrong weight on a bar (`accessibility` §8).
 *
 * Takes the weight **already in `unit`** — this function never converts, so
 * the spoken number and the printed one cannot disagree.
 */
export function speakLoad(displayWeight: number | null, reps: number, unit: WeightUnit): string {
  const repsWords = `${String(reps)} ${reps === 1 ? 'rep' : 'reps'}`;
  if (displayWeight === null) return repsWords;

  const noun = unit === 'kg' ? 'kilogram' : 'pound';
  const weightWords = `${String(displayWeight)} ${displayWeight === 1 ? noun : `${noun}s`}`;

  return `${weightWords} for ${repsWords}`;
}

/**
 * Kilograms → the number the client reads, rounded exactly as
 * `formatWeight` prints it. The `packages/utils` edge, and the only place
 * this feature crosses it (`CLAUDE.md` §0).
 */
export function toDisplayWeight(kg: number | null, unit: WeightUnit): number | null {
  return kg === null ? null : Number(formatWeight(kg, unit));
}

/** A stepper reading 0 is a set with no external load, not a 0kg lift. */
function displayLoad(weight: number): number | null {
  return weight === 0 ? null : weight;
}

const styles = StyleSheet.create({
  pinned: {
    flexShrink: 0,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // Wraps rather than truncating at 200% text; `minHeight` so it grows
    // instead of clipping.
    flexWrap: 'wrap',
    rowGap: spacing(6),
    minHeight: 33,
  },
  upper: {
    textTransform: 'uppercase',
  },
  weight: {
    marginTop: spacing(8),
    minHeight: density.client.button,
  },
  context: {
    marginTop: spacing(4),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 20,
  },
  contextSlot: {
    flexShrink: 1,
  },
  contextSlotEnd: {
    flexShrink: 1,
    alignItems: 'flex-end',
  },
  action: {
    marginTop: spacing(8),
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(10),
    minHeight: 52,
  },
  reps: {
    flex: 1,
    minWidth: 0,
  },
});
