'use server';

// The POST half of the route. Separated from `page.tsx` so the render path
// has no import edge to `./confirm` at all — the "a GET leaves the token
// unconsumed" guarantee (`guardian-consent/05` Approach step 2) is a
// structural property here, not a discipline, and `page.test.tsx` asserts
// it against the source.

// Extensionless: `apps/web` resolves with `moduleResolution: bundler`, not
// Node's native loader, so it does not take the `.ts` specifiers `apps/api`
// uses.
import { confirmGuardianConsent, type GuardianConsentOutcome } from './confirm';

/**
 * Bound to the token in `page.tsx`. Next serialises the bound argument into
 * the form's `$ACTION_*` hidden fields so a no-JS POST still carries it —
 * which is fine here and nowhere near a leak: the token is already in the
 * address bar of the page rendering that form.
 *
 * `useActionState` calls this with `(previousState, formData)`; neither is
 * declared, because neither is used — the token is the whole input and it
 * arrives through the binding.
 */
export async function confirmAction(token: string): Promise<GuardianConsentOutcome> {
  return confirmGuardianConsent(token);
}
