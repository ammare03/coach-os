import { Card, IconButton, NumberStepper, Text, resolveButtonVariantVisuals } from '@coachos/ui';
import { density, spacing, useTheme } from '@coachos/ui/theme';
import { formatWeight, type WeightUnit } from '@coachos/utils';
import { Check } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { SetFlagChips } from './SetFlagChips.tsx';

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
  /**
   * The same sentence for a warm-up, which has no set number to name. It is
   * also the only place the composer still says "warm-up set" out loud once
   * the visible head label is omitted, so it is not optional politeness.
   */
  confirmWarmupLabel: (load: string) => `Log warm-up set, ${load}`,
  /** The announcement's warm-up form, for the same reason. */
  warmupLoggedAnnouncement: (load: string) => `Warm-up set logged, ${load}`,
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

  // ── `set-entry/05`, the editor ────────────────────────────────────────
  /** The editor's head label, and the collapsed bar's. Both say the same thing. */
  editingSetLabel: (setNumber: number) => `Editing set ${String(setNumber)}`,
  /** A warm-up is never numbered, so it names itself instead (design spec). */
  editingWarmupLabel: 'Editing warm-up',
  cancelEdit: 'Cancel',
  /** Spoken: which set the Cancel abandons, since two Cancels are on screen. */
  cancelEditLabel: (setNumber: number) => `Cancel editing set ${String(setNumber)}`,
  cancelEditWarmupLabel: 'Cancel editing warm-up',
  /** `Save set 2, 82.5 kilograms for 7 reps` — the confirm's sentence in edit mode. */
  saveLabel: (setNumber: number, load: string) => `Save set ${String(setNumber)}, ${load}`,
  saveWarmupLabel: (load: string) => `Save warm-up set, ${load}`,
  /** A logged row's hint. The row is a button; this is what pressing it does. */
  editHint: 'Double tap to edit',
  /** The save's counterpart to `loggedAnnouncement` — a correction is not a new set. */
  updatedAnnouncement: (setNumber: number, load: string) =>
    `Set ${String(setNumber)} updated, ${load}`,
  warmupUpdatedAnnouncement: (load: string) => `Warm-up set updated, ${load}`,
  /**
   * `updateSet` rejects on the same local-mirror fault `logSet` does, so the
   * same voice — but it says "save that change", because nothing was logged.
   */
  editFailed: 'Couldn’t save that change. Try again.',

  // ── `set-entry/06`, deleting ──────────────────────────────────────────
  /** The editor's destructive action (design frame F), beside Cancel. */
  deleteSet: 'Delete set',
  /** Spoken: which set goes, since two rows could be open to a screen reader. */
  deleteSetLabel: (setNumber: number) => `Delete set ${String(setNumber)}`,
  deleteWarmupLabel: 'Delete warm-up set',
  /**
   * The swipe's reveal panel, and the logged row's custom action. One word
   * behind the row because it is a target the thumb is already over; the
   * custom action spells the set out through `deleteSetActionLabel`.
   */
  swipeDelete: 'Delete',
  /**
   * `commitDeleteSet` rejects on the same local-mirror fault the other two
   * do. It is reachable only after the undo window closed, and by then the
   * row is visible again — so the copy has to explain a row that came back.
   */
  deleteFailed: 'Couldn’t delete that set. Try again.',
} as const;

export type SetEntryMode = 'create' | 'edit';

/**
 * `Editing set 2` · `Editing warm-up` — the editor's head label and the
 * collapsed bar's, resolved once so the two can never word it differently.
 */
export function editingLabel(setNumber: number, isWarmup: boolean): string {
  return isWarmup ? SET_ENTRY_COPY.editingWarmupLabel : SET_ENTRY_COPY.editingSetLabel(setNumber);
}

/** The same rule, for the Cancel beside it. */
export function cancelEditingLabel(setNumber: number, isWarmup: boolean): string {
  return isWarmup
    ? SET_ENTRY_COPY.cancelEditWarmupLabel
    : SET_ENTRY_COPY.cancelEditLabel(setNumber);
}

/**
 * `Delete set 2` · `Delete warm-up set` — spoken by both non-gesture entry
 * points (`set-entry/06`): the editor's button and the logged row's custom
 * action. Resolved here so the two cannot word the same deletion differently.
 */
export function deleteSetActionLabel(setNumber: number, isWarmup: boolean): string {
  return isWarmup ? SET_ENTRY_COPY.deleteWarmupLabel : SET_ENTRY_COPY.deleteSetLabel(setNumber);
}

const CONFIRM_ICON_SIZE = 20;

/** Reps are 1–100, step 1 (design spec). The stepper clamps; nothing below can be invalid. */
const REPS_MIN = 1;
const REPS_MAX = 100;

/** 500kg / 1100lb — a ceiling in the unit the client reads, never a converted one. */
const WEIGHT_MAX: Record<WeightUnit, number> = { kg: 500, lb: 1100 };

export interface SetEntryRowProps {
  /**
   * `'edit'` is the same card, in the list, over the row it is correcting —
   * not a second component. It adds exactly two things to the create
   * anatomy (design spec): the flags move to a second head line, and the
   * head's trailing seam carries Cancel instead of them. The head label
   * becomes `Editing set 2` and the confirm says `Save`, because neither
   * mode may be mistaken for the other while both are one file.
   *
   * **Only one `SetEntryRow` is ever mounted.** The pinned composer
   * collapses to `EditingBar` while the editor is open, so nothing on
   * screen can log a new set mid-edit and no `testID` is ever duplicated.
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
   * `set-entry/04`'s two flags. Both default `false`, so a working set is
   * still exactly two taps (§8.4) — the chips are secondary and sit nowhere
   * near the path from stepper to confirm.
   *
   * Supplying the two handlers is what mounts `SetFlagChips` into the head's
   * trailing seam; a caller that has nowhere to put the flags gets the band
   * it always had.
   */
  isWarmup?: boolean;
  isFailure?: boolean;
  onWarmupChange?: (next: boolean) => void;
  onFailureChange?: (next: boolean) => void;
  /**
   * **The head band's trailing occupant, when it is not the flags.**
   * `set-entry/05` puts Cancel and Delete set here and moves the chips to
   * their own line; supplied, it replaces them rather than joining them —
   * 270px carries one occupant, not two.
   *
   * The chips take ~191px of that 270, which is why the head label is
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
  /**
   * **Seam — `set-entry/02`'s `NearestWeightLine`.** A sibling BELOW the
   * band, not a third occupant of it: the band is `space-between`, so a
   * child there would sit beside the plates rather than under them.
   *
   * The one place in this file's header that is allowed to be conditional —
   * an occupant here takes the card to 229 and resolves in one tap. The
   * +24px is the line's own `marginTop` and `minHeight`; this slot declares
   * no size, so an empty seam leaves the card at exactly 205.
   */
  contextBelow?: ReactNode;
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
  isWarmup = false,
  isFailure = false,
  onWarmupChange,
  onFailureChange,
  headTrailing,
  contextLeading,
  contextTrailing,
  contextBelow,
  testID,
}: SetEntryRowProps) {
  const theme = useTheme();
  // Kept in step with the variant rather than hardcoded, so a white-label
  // brand that needs dark ink on its primary does not get a white tick.
  const iconColor = resolveButtonVariantVisuals('primary', false, false, theme).textColor;
  const load = speakLoad(displayLoad(weight), reps, unit);

  // **The head label is the set number, and a warm-up has none.** `Warm-up
  // set` needs ~86px of the ~71 the chips leave and would wrap the head to a
  // second line, taking the card off 205px — the one thing this layout may
  // not do. The selected chip is the label instead, and set 1 is the first
  // *working* set, so there was never a number to print.
  const showsSetLabel = mode !== 'edit' && !isWarmup;
  const isEditing = mode === 'edit';

  const flags =
    onWarmupChange === undefined || onFailureChange === undefined ? null : (
      <SetFlagChips
        isWarmup={isWarmup}
        isFailure={isFailure}
        onWarmupChange={onWarmupChange}
        onFailureChange={onFailureChange}
        testID="set-entry-flags"
      />
    );

  // The editor names itself instead of the set number — it is the one label
  // that has to survive the chips moving off this line, because with two
  // Cancels on screen (here and on the collapsed bar) nothing else says
  // WHICH set is open.
  //
  // The 205px contract is a **create-mode** contract: this card is in the
  // list, over the row it corrects, not pinned under it. The flags line
  // below is why the two modes may not share a height.
  const editLabel = isEditing ? editingLabel(setNumber, isWarmup) : null;

  return (
    // The wrapper, not the `Card`, carries `flexShrink: 0` — `Card` owns its
    // own surface and takes no style. This is what makes the list above
    // give way instead of the card compressing.
    <View style={styles.pinned} testID={testID}>
      {/* `density="coach"` is the 14px padding, not a role claim: 18 pushes
          the confirm out of the slot. */}
      <Card elevation="raised" density="coach">
        <View style={styles.head} testID="set-entry-head">
          {editLabel !== null ? (
            // `tone="warm"`, not `muted` — the one visual difference between
            // a card that is composing and a card that is correcting.
            <Text size="eyebrow" tone="warm" style={styles.upper} testID="set-entry-editing-label">
              {editLabel}
            </Text>
          ) : showsSetLabel ? (
            <Text size="eyebrow" tone="muted" style={styles.upper}>
              {SET_ENTRY_COPY.setLabel(setNumber)}
            </Text>
          ) : null}
          {/* One occupant: the caller's head actions if it supplied any, else
              the flags. The band stands either way, and at its own minimum
              when it holds neither. In edit mode the actions take it
              outright and the flags move to their own line below — 270px
              carries one occupant, not three. */}
          {isEditing ? headTrailing : (headTrailing ?? flags)}
        </View>

        {/* **The editor's one extra band**, and the reason edit mode is not
            205px. Create mode never mounts it: the chips are in the head
            there, and a line here would move the confirm. */}
        {isEditing && flags !== null ? (
          <View style={styles.flagsLine} testID="set-entry-flags-line">
            {flags}
          </View>
        ) : null}

        <View style={styles.weight} testID="set-entry-weight-band">
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

        {/* Unstyled on purpose — see `contextBelow`. Present even when empty
            so the seam is one node whether or not it is occupied. */}
        <View testID="set-entry-below">{contextBelow}</View>

        <View style={styles.action} testID="set-entry-action">
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
            // A warm-up names itself rather than a number it does not have —
            // and with the visible head label gone, this is where a screen
            // reader learns which kind of set it is about to log.
            //
            // `Save`, not `Log`, in edit mode: the client is correcting a
            // set that already exists, and a screen reader hearing "Log set
            // 2" on a set already logged would reasonably expect a second.
            accessibilityLabel={resolveConfirmLabel(isEditing, isWarmup, setNumber, load)}
            testID="set-entry-confirm"
          />
        </View>
      </Card>
    </View>
  );
}

/** The confirm's whole sentence, across both modes and both flag states. */
function resolveConfirmLabel(
  isEditing: boolean,
  isWarmup: boolean,
  setNumber: number,
  load: string,
): string {
  if (isEditing) {
    return isWarmup
      ? SET_ENTRY_COPY.saveWarmupLabel(load)
      : SET_ENTRY_COPY.saveLabel(setNumber, load);
  }
  return isWarmup
    ? SET_ENTRY_COPY.confirmWarmupLabel(load)
    : SET_ENTRY_COPY.confirmLabel(setNumber, load);
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
  flagsLine: {
    // Edit mode only. `minHeight` is the chip's own 33, so 200% text grows
    // the line instead of clipping a pill (`accessibility` §3).
    marginTop: spacing(6),
    minHeight: 33,
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
