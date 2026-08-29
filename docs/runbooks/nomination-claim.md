# Nomination claim

## What this means

Someone has contacted CoachOS claiming the right to act on a deceased or
incapacitated user's account, citing that user's DPDP nomination
(`COMPLIANCE.md` CO§3.2) — `users.nominee_name` / `users.nominee_email`
(`DATABASE.md` DB§5.1). This is **not** a support ticket and does not follow
`SUPPORT.md` SU§4. There is no in-app or self-service path for this, on
purpose (`account-lifecycle/12`'s own governing rule): acting on a claimed
death or loss of capacity without a human verifying it first is a fraud
route with irreversible consequences, and no verification step here is ever
automated.

## Who handles this

Ammar, until there is someone else. Same standard as `SUPPORT.md` SU§5's
trust & safety escalations — this is not delegable to a contractor without
training, for the same reason: the outcome is irreversible and the claimant
is, by definition, not the account holder.

## Before doing anything

1. **Do not touch the account.** No export, no deletion, no password reset,
   no read of the account's data, until verification (below) is complete.
2. Confirm the claimant's stated relationship to the account matches
   `nominee_name` on the user's row. A claimant who does not match the
   recorded nominee is refused outright — there is no override.
3. Note the account's `nominee_email`. Correspondence about this claim goes
   there and to the address the claimant contacted from, never anywhere
   else — this is a paper trail, not a private negotiation.

## Verification (required, every time)

The claimant must provide **one** of:

- A death certificate naming the account holder, or
- A power of attorney or court order naming the claimant, covering data
  access or account administration.

A photo of a document, a claimed relationship with no paperwork, or an
emotional appeal is **never** sufficient, regardless of how plausible it
sounds. If the document doesn't clearly name both the account holder and the
claimant's authority, ask for a better one — do not proceed on a partial
match "to be helpful."

If verification cannot be completed with confidence, **refuse the claim**
and tell the claimant what would be needed instead. Refusing a genuine claim
costs a delay and an apology. Honouring a fraudulent one costs someone else's
entire account.

## What to do once verified

1. Record the verification: what document was provided, its key details
   (not a stored copy of the document itself — see Retention below), the
   date, and who reviewed it.
2. Write an `audit_log` entry: `actor_user_id` = null (the claimant has no
   CoachOS account acting here), `target_type` = `'user'`, `target_id` = the
   account holder's id, `action` = `'account.nomination_claim_honoured'`,
   `metadata` = `{ claimantEmail, verificationType: 'death_certificate' |
'power_of_attorney' }` — no document contents, no free-text claimant name
   (DB§18: metadata carries operational facts, never PII beyond what's
   already elsewhere).
3. Determine what the claimant is actually asking for:
   - **A copy of the account's data** — run the same `data-export` job
     `account-lifecycle/09` already built, the same way `support.
triggerUserExport` does for an operator-triggered export, but deliver
     the archive to the **verified claimant's own email** (never a
     surprise address, never whatever email they first emailed from,
     unless that address was itself named in the document).
   - **Deletion of the account** — follow the existing `CLAUDE.md` §21.4
     flow on the claimant's behalf, same 7-day grace and same purge order.
   - Anything else (transferring the account, changing its data) is **out
     of scope** — CoachOS does not have a mechanism for a nominee to operate
     an account, only to exercise the deceased or incapacitated holder's
     export and deletion rights on their behalf.

## Retention

Keep the verification record (bullet 1 above) and the `audit_log` entry.
**Do not keep a copy of the death certificate or power of attorney itself**
longer than needed to complete the claim — it is sensitive personal data
belonging to people who are not CoachOS users, and its evidentiary purpose
ends once the claim is honoured or refused.

## What NOT to do

- Do not act on a claim with no document.
- Do not accept a document that doesn't name both parties clearly.
- Do not deliver an export to any address other than the one the
  verification named.
- Do not treat repeated follow-up pressure from a claimant as a reason to
  skip a step — a genuine claim survives the same delay a fraudulent one
  would try to avoid.
- Do not automate any part of this. If a future engineer proposes building
  a self-service nomination-claim flow, that is a `CLAUDE.md` §27 product
  decision, not a bug fix — this runbook exists because that decision was
  already made, deliberately, the other way.

## Last exercised

Not yet exercised. No real claim has been received as of this writing.
