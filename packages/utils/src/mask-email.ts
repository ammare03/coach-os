// `guardian-consent/06` Approach step 1 — the guardian's address, reduced
// to something a screen can say without the device ever holding it.
//
// **This runs server-side only, and the full address never crosses the
// wire.** The minor's app has to name *which* inbox to check, or "we
// emailed your parent" is unactionable when the parent has three. But the
// full address belongs to a third party who is not a CoachOS user
// (`CLAUDE.md` §21.1, Personal), and a response carrying it would let a
// patched client read it straight back out. The coach never sees it at all
// (`auth-server/07` step 5).
//
// One character of the local part is kept because that is what makes the
// mask recognisable to the person who typed it — enough to tell mum's inbox
// from dad's, not enough to reconstruct either.

const DOTS = '•••';

/**
 * `jane.doe@gmail.com` → `j•••@gmail.com`.
 *
 * The domain is kept whole: it is the half a fifteen-year-old actually
 * recognises, and it is not identifying on its own.
 *
 * Anything that is not a plausible address — no `@`, an empty local part,
 * an empty domain — masks to `•••` rather than falling back to the input.
 * A masker whose failure mode is "return what you were given" is not a
 * masker.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) {
    return DOTS;
  }
  return `${email[0]}${DOTS}${email.slice(at)}`;
}
