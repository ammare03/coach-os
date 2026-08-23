import { strictObject } from 'zod';

/**
 * The one constructor every schema module in this package calls instead of
 * bare `z.object` (`error-and-validation/03-validation-conventions.md` step
 * 1). Zod's own default silently strips unknown keys — a device that sends
 * `weight_kg` where the schema names `weightKg` gets a 200 response with the
 * weight missing, not a failure it can see. Re-exporting Zod's own
 * `strictObject` rather than hand-rolling `z.object(shape).strict()`: the
 * point is a helper shorter than the thing it replaces, and Zod already
 * ships one.
 *
 * Two relaxations exist, both explicit and both narrow — neither routes
 * through here:
 *   - inbound webhook bodies (RevenueCat, LiveKit): passthrough on unknown
 *     keys, since rejecting an unrecognised field means dropping a
 *     subscription event (DB§17).
 *   - `checkins.responses` / `checkin_templates.fields`: schema'd per
 *     template in P16, genuinely schemaless JSONB (DB§2).
 */
export { strictObject };
