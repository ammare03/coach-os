import type { WeightUnit } from '@coachos/utils';

import { api } from '../lib/trpc.ts';

/**
 * The unit this user reads weights in — display only, and never an input to
 * what gets stored (`CLAUDE.md` §0, DB§5.1.1). One hook rather than a
 * `me?.weightUnit ?? 'kg'` at each call site, so the fallback for a
 * profile that has not loaded yet is decided in one place.
 *
 * Safe to call from a list row: `me.get` is a single TanStack Query cache
 * entry, so twenty blocks on a program day share one request, not twenty
 * (`code-conventions` §5).
 */
export function useWeightUnit(): WeightUnit {
  const { data: me } = api.me.get.useQuery();
  return me?.weightUnit ?? 'kg';
}
