import { useReducedMotion } from '@coachos/ui/theme';
import type { WeightUnit } from '@coachos/utils';
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

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
  testID?: string;
}

export function SetList({
  sets,
  unit,
  enteringLocalId = null,
  renderTrailing,
  testID,
}: SetListProps) {
  const reducedMotion = useReducedMotion();
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    if (sets.length === 0) return;
    // `animated: false` under reduced motion (`accessibility` §6) — the
    // position still changes, only the travel is dropped.
    scroll.current?.scrollToEnd({ animated: !reducedMotion });
  }, [sets.length, reducedMotion]);

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
      {sets.map((set) => (
        <SetRow
          key={set.localId}
          set={set}
          unit={unit}
          isEntering={set.localId === enteringLocalId}
          trailing={renderTrailing?.(set)}
          testID={`set-row-${set.localId}`}
        />
      ))}
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
});
