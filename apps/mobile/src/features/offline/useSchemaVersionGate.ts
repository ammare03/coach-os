import { useCallback, useEffect, useState } from 'react';

import {
  checkSchemaVersion,
  confirmSchemaVersionReset,
  type OutboxGroupCount,
} from '../../db/schema-version.ts';

export type SchemaVersionGatePhase = 'checking' | 'ready' | 'confirm-required';

export type SchemaVersionGate = {
  phase: SchemaVersionGatePhase;
  /** Only meaningful while `phase === 'confirm-required'`. */
  counts: OutboxGroupCount[] | null;
  isClearing: boolean;
  /**
   * Returns the underlying promise so tests (and any future caller that
   * cares) can observe a failure — `Button`'s `onPress` and this dialog's
   * fire-and-forget usage both discard it, which TypeScript allows for any
   * `() => void`-typed call site regardless of what the function returns.
   */
  confirm: () => Promise<void>;
};

/**
 * Wires `checkSchemaVersion()` into `app/_layout.tsx`'s splash-hold
 * sequence. `phase` starts `'checking'` — the layout treats this exactly
 * like its native-chrome/cache-restore/auth conditions, so the splash never
 * lifts onto a route that might read a stale-schema local database
 * (`local-database/04`'s Acceptance criteria: "the check runs before any
 * other app code reads from the local database").
 *
 * The check itself resolves any case that does not need a person's input
 * (first run, matching version, mismatch with an empty outbox) straight to
 * `'ready'` — `'confirm-required'` is reached only for the two states the
 * approved design actually renders a dialog for.
 */
export function useSchemaVersionGate(): SchemaVersionGate {
  const [phase, setPhase] = useState<SchemaVersionGatePhase>('checking');
  const [counts, setCounts] = useState<OutboxGroupCount[] | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void checkSchemaVersion().then((result) => {
      if (cancelled) return;
      if (result.status === 'ok') {
        setPhase('ready');
      } else {
        setCounts(result.counts);
        setPhase('confirm-required');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const confirm = useCallback(async () => {
    setIsClearing(true);
    try {
      await confirmSchemaVersionReset();
      setPhase('ready');
    } catch (error) {
      // The wipe itself failing (not the mismatch — that's the expected
      // path this whole file exists for) is a native-storage failure, not
      // a product decision this dialog can route around. Reset the busy
      // state so the button is pressable again, then let the rejection
      // surface to Sentry's global handler (`lib/sentry.ts`) rather than
      // swallowing it (`code-conventions` §8).
      setIsClearing(false);
      throw error;
    }
  }, []);

  return { phase, counts, isClearing, confirm };
}
