// `client_seat_limit` — DERIVED, never stored (`CLAUDE.md` §15.7, §27: "Compute
// it in one place in packages/utils and nowhere else"). This is the
// closed-form half of that formula only — `tierSeats[tier] + seatPacks * 5`,
// with Agency's unlimited case folded in here per §15.7's own note that
// Agency is "the one exception, resolved in the same function."
//
// `phase-20-billing-and-entitlements/entitlement-service/03` owns the real
// implementation (proration, grace periods, billing-cycle timing). Until
// that phase exists, `invites/01`'s seat check calls this stub — documented
// here, not silently assumed, per that task's own Risks section.
// TODO(phase-20-billing-and-entitlements/entitlement-service/03): replace
// with the real entitlement service.

export type SubscriptionTier = 'starter' | 'coach' | 'pro' | 'studio' | 'agency';

const TIER_SEATS: Record<Exclude<SubscriptionTier, 'agency'>, number> = {
  starter: 2,
  coach: 10,
  pro: 30,
  studio: 75,
};

const SEATS_PER_PACK = 5;

/**
 * A coach's current client-seat limit. `Infinity` for Agency (§15.2's
 * "Unlimited" row) — every caller must handle that explicitly rather than
 * comparing a used-seat count against a finite number.
 */
export function deriveClientSeatLimit(tier: SubscriptionTier, seatPacks: number): number {
  if (tier === 'agency') {
    return Infinity;
  }
  return TIER_SEATS[tier] + seatPacks * SEATS_PER_PACK;
}
