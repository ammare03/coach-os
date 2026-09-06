import { useEffect, useState } from 'react';

/**
 * Trailing-edge debounce. Promoted here from `ExerciseForm`'s private copy
 * on its second consumer — the exercise picker's search
 * (`exercise-library/05`) — per `code-conventions` §1, and `src/hooks` is
 * where that skill names generic hooks like this one.
 *
 * Returns the latest `value` once it has stopped changing for `delayMs`.
 * The first value is returned immediately; only changes are delayed.
 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debounced;
}
