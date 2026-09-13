import { useEffect, useState } from 'react';

/**
 * A value that is true for a while and then simply is not — the Notes tab's
 * "this surface arrived because of a tap I just handled" (`useEnterMotion`).
 *
 * **Why it expires rather than being consumed.** The obvious shape is to
 * clear the ticket on the commit that used it, but that is a `setState`
 * inside an effect, i.e. a cascading render on a screen whose list is the
 * thing being scrolled. Expiry costs one timer, never re-renders the list
 * to erase anything, and is the stronger guarantee anyway: consumption
 * relies on the surface actually mounting, and a pinned row scrolled off
 * the top never does — leaving a ticket behind for the recycler to find.
 *
 * The window is a budget, not an animation duration. It has to outlast the
 * gap between the tap and the optimistic cache patch, and it has to close,
 * because an authorisation that never does is one a later scroll can claim.
 */
export function useExpiringTicket<T>(windowMs: number): [T | null, (value: T) => void] {
  const [ticket, setTicket] = useState<T | null>(null);

  useEffect(() => {
    if (ticket === null) return;
    const timer = setTimeout(() => {
      setTicket(null);
    }, windowMs);
    return () => {
      clearTimeout(timer);
    };
  }, [ticket, windowMs]);

  return [ticket, setTicket];
}
