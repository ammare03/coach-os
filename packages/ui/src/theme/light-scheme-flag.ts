/**
 * Whether the light scheme is a choice a user may make.
 *
 * `false`, and deliberately so: `schemes.ts`'s light table is a role
 * inversion with no spec behind it — `DESIGN.md` §1.1 defines one palette —
 * so it exists for a user who has forced light at the OS level, not as a
 * second designed product. `settings-shell/03` builds the whole preference
 * (store, persistence, provider seam, control) against this flag so that
 * turning Light on later is one edit rather than a retrofit.
 *
 * **`phase-22-release-engineering/light-scheme/02` flips it**, after `/01`
 * designs the palette and audits every primitive under it. That task also
 * widens the preference schema to accept `'system'` and removes the store's
 * refusal — this constant is read by both the control and the store, which
 * is what makes the two impossible to disagree.
 *
 * Typed `boolean` rather than left as the literal `false`: a `false` literal
 * type narrows every `if (LIGHT_SCHEME_AVAILABLE)` branch to dead code, and
 * the branches are the thing being kept alive.
 */
export const LIGHT_SCHEME_AVAILABLE: boolean = false;
