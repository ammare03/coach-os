import { spacing, useReducedMotion } from '@coachos/ui/theme';
import type { WeightUnit } from '@coachos/utils';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { SetRow, type LoggedSetView } from './SetRow.tsx';

// `set-entry/01` — the receipt. Every set logged for this exercise in this
// session, oldest at the top, and it gives way to the composer rather than
// the other way round.
//
// **Bottom-aligned and it auto-scrolls to the end.** The slot leaves about
// 60px here, which is one and a half rows: the useful row is always the
// most recent one, so short content sits at the bottom against the card
// (`flexGrow` + `flex-end`) instead of floating at the top of a gap, and a
// new set is scrolled to without the client's thumb leaving the confirm.
//
// **A `ScrollView`, deliberately, and this is the exception to
// `ui-conventions` §6's FlashList rule.** That rule exists for the 400-row
// histories that collapse a `FlatList`; this list is bounded by the sets one
// client does of one exercise — a dozen, rarely twenty — inside a 60px
// viewport. Recycling would cost a measurement pass per set logged AND
// break `SetRow`'s mount-keyed entrance, since a recycled row does not
// mount. The `accessibility` note in the spec asks for this same
// `ScrollView` at 200% text, for the same reason.
//
// **No empty state.** The composer below is the content; a dash or a
// placeholder here would be noise, and an absence is not a failure
// (`COPY.md` §CO2).

export interface SetListProps {
  /** In `setNumber` order. Warm-ups keep their place and carry no number. */
  sets: readonly LoggedSetView[];
  unit: WeightUnit;
  /**
   * The set that just landed — the only row that plays an entrance. `null`
   * on first mount, so reopening a session mid-workout does not replay
   * every row.
   */
  enteringLocalId?: string | null;
  /**
   * **Seam — tasks 03 and 04.** The row's single trailing occupant: a flag
   * tag, else this set's previous performance, else nothing. Resolved here
   * rather than inside `SetRow` because the priority is a product rule, not
   * a layout one.
   */
  renderTrailing?: (set: LoggedSetView) => ReactNode;
  /**
   * **The same seam, spoken.** A row is one accessible element, so whatever
   * `renderTrailing` draws is silent unless its words arrive here — see
   * `SetRow.trailingLabel`. Kept beside `renderTrailing` rather than inside
   * it so both stay stable callbacks (`frontend-performance` §3).
   */
  renderTrailingLabel?: (set: LoggedSetView) => string | undefined;
  /**
   * **Seam — `set-entry/05`.** The set currently open for correction, which
   * renders `renderEditor` in place of its row. `null` is the ordinary
   * state, and it is also what makes every other row tappable: one editor at
   * a time, so no tap can discard an open edit by accident.
   */
  editingLocalId?: string | null;
  /** The editor card, mounted where the row was. Only for `editingLocalId`. */
  renderEditor?: (set: LoggedSetView) => ReactNode;
  /**
   * Tapping a logged row. One stable callback for the whole list rather than
   * a closure per row — `SetRow` is memoised and a fresh `onEdit` each render
   * would defeat it for twelve rows, mid-set.
   */
  onEditSet?: (set: LoggedSetView) => void;
  /**
   * **Seam — `set-entry/06`.** The sets whose undo window is open, or whose
   * delete has already committed (`useDeleteSet().hiddenSetIds`). They are
   * filtered out of the render **here and nowhere else**, which is the
   * distinction the whole task turns on: nothing has been deleted, only
   * hidden, so Undo is a set membership change and not a second mutation.
   *
   * The caller keeps them in `sets`, deliberately — `highestWorkingSetNumber`
   * counts them, so deleting set 4 of 4 still makes the next set 5. Filtering
   * upstream would hand the next set a number a restored row already holds.
   */
  hiddenLocalIds?: ReadonlySet<string>;
  /**
   * **`personal-records/03` — the sets that took a record**, by
   * `client_local_id`. A set membership rather than a field on the row for
   * the same reason `hiddenLocalIds` is one: it arrives from the server,
   * long after the row was created, and folding it into `LoggedSetView`
   * would mean rebuilding every row object each time one set syncs.
   */
  recordLocalIds?: ReadonlySet<string>;
  /**
   * Swiping a logged row left, or taking its `Delete set` custom action.
   * One stable callback for the list, for `onEditSet`'s reason.
   */
  onDeleteSet?: (set: LoggedSetView) => void;
  /**
   * **Seam — `session-modifications/01`'s `AddSetButton`.** The list's
   * terminus, inside the scroll rather than beside it: the list is
   * bottom-aligned and scrolls to its end, so "below the last set row" and
   * "always on screen" are the same position here. A sibling outside would
   * take its height from the list, which is the only surface in the slot
   * that has any to give (`SetEntrySlot`'s header).
   */
  footer?: ReactNode;
  testID?: string;
}

/** No deletes pending — a stable identity, so the memo below does not rebuild. */
const NO_HIDDEN: ReadonlySet<string> = new Set<string>();
const NO_RECORDS: ReadonlySet<string> = new Set<string>();

export function SetList({
  sets,
  unit,
  enteringLocalId = null,
  renderTrailing,
  renderTrailingLabel,
  editingLocalId = null,
  renderEditor,
  onEditSet,
  hiddenLocalIds = NO_HIDDEN,
  recordLocalIds = NO_RECORDS,
  onDeleteSet,
  footer,
  testID,
}: SetListProps) {
  const reducedMotion = useReducedMotion();
  const scroll = useRef<ScrollView>(null);
  /** The editor we have already scrolled to — so a stepper tap cannot re-scroll. */
  const scrolledTo = useRef<string | null>(null);

  // The rows that are actually on screen. A hidden row is unmounted, which
  // is what plays `SetRow`'s exit and lets the rows below it close the gap
  // (`Layout`, design spec) — and what makes an undo a plain remount, with
  // nothing to re-read and nothing to re-create.
  const visible = useMemo(
    () =>
      hiddenLocalIds.size === 0 ? sets : sets.filter((set) => !hiddenLocalIds.has(set.localId)),
    [sets, hiddenLocalIds],
  );

  useEffect(() => {
    if (visible.length === 0) return;
    // Never while an editor is open: the client is looking at a card in the
    // middle of the list, and yanking to the end would lose it.
    if (editingLocalId !== null) return;
    // `animated: false` under reduced motion (`accessibility` §6) — the
    // position still changes, only the travel is dropped.
    scroll.current?.scrollToEnd({ animated: !reducedMotion });
  }, [visible.length, reducedMotion, editingLocalId]);

  useEffect(() => {
    // Armed for the next editor the moment this one closes. In an effect,
    // not in render — a ref read during render is a concurrent-mode hazard.
    if (editingLocalId === null) scrolledTo.current = null;
  }, [editingLocalId]);

  // The editor is taller than the ~221px this list gets while the composer
  // is collapsed, so it is brought to the top of the viewport once, on open
  // — which is what makes its confirm reachable (design spec, 200% text).
  const handleEditorLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (editingLocalId === null || scrolledTo.current === editingLocalId) return;
      scrolledTo.current = editingLocalId;
      scroll.current?.scrollTo({ y: event.nativeEvent.layout.y, animated: !reducedMotion });
    },
    [editingLocalId, reducedMotion],
  );

  // `undefined` while an editor is open drops the `button` role and the
  // "Double tap to edit" hint from every other row (design frame F) — and,
  // for `SetRow.onDelete`'s reason, the swipe and the custom action with it.
  // The open editor carries its own `Delete set`.
  const rowOnEdit = editingLocalId === null ? onEditSet : undefined;
  const rowOnDelete = editingLocalId === null ? onDeleteSet : undefined;

  return (
    <ScrollView
      ref={scroll}
      style={styles.list}
      contentContainerStyle={styles.content}
      // The list is the surface that gives way; the composer must never be
      // pushed off by it.
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      testID={testID}
    >
      {visible.map((set) =>
        set.localId === editingLocalId && renderEditor !== undefined ? (
          // In place, over the row it corrects — the client can still see
          // which set they are changing, which is the whole reason the
          // editor is not in the pinned card.
          <View
            key={set.localId}
            style={styles.editor}
            onLayout={handleEditorLayout}
            testID={`set-editor-${set.localId}`}
          >
            {renderEditor(set)}
          </View>
        ) : (
          <SetRow
            key={set.localId}
            set={set}
            unit={unit}
            isEntering={set.localId === enteringLocalId}
            isRecord={recordLocalIds.has(set.localId)}
            trailing={renderTrailing?.(set)}
            trailingLabel={renderTrailingLabel?.(set)}
            onEdit={rowOnEdit}
            onDelete={rowOnDelete}
            testID={`set-row-${set.localId}`}
          />
        ),
      )}
      {footer}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    // Without this the list refuses to shrink below its content and pushes
    // the composer out of the slot — the one layout bug this file can have.
    minHeight: 0,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  editor: {
    // The card sits off the hairlines either side of it, so it reads as a
    // surface over the list rather than a very tall row.
    marginVertical: spacing(8),
  },
});
