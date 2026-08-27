# P4 — Report SLA

## What this means

A trust-and-safety report has been sitting untriaged for too long against
the published 24-hour commitment (`SUPPORT.md` SU§6, `CLAUDE.md` §21.6) —
OB§3.3 sets the alert threshold at 18 hours, escalating at 22h, specifically
so there is time to act before the 24-hour promise is actually broken.

**Not yet automated.** This alert depends on `coaching.reports` and the
reporting flow, both owned by `phase-26-trust-and-safety` and not built at
the time this runbook was written
(`apps/api/src/jobs/alert-evaluator.ts`'s own doc comment names this gap
explicitly). Until that phase ships, treat this runbook as the manual
process for anyone who notices a report aging past 18 hours by other means
(a coach or client following up, or a manual query once the table exists) —
and revisit this runbook the same day that phase lands, since it will need
the real query this section is a placeholder for.

## First three checks

1. Once `coaching.reports` exists: the oldest untriaged report's age —
   `SELECT id, created_at, reason FROM coaching.reports WHERE status = 'open' ORDER BY created_at ASC LIMIT 5;`
   (table/column names provisional until that phase's migration lands).
2. Is this one old report, or several — one old report is a missed
   notification; several is a triage capacity problem.
3. Who is the assigned operator, and are they actually available right now
   (SU§2's admin surface, also not yet built) — an alert with nobody to act
   on it is the exact failure mode OB§4's "actionable at 3am by one person"
   rule exists to prevent.

## Likely causes

1. The report notification itself failed silently (email/push delivery
   issue — check `alert.delivery_failed` log lines for this alert id).
2. Nobody was available to triage (solo/two-person team, PTO, etc.) —
   process gap, not a system bug.
3. A report was miscategorised on intake and didn't surface in the normal
   queue.

## What to do

1. Open the report and read it in full — SU§5's rule is that reviewing a
   report is itself the consent event; you're allowed to look at exactly
   this reported item and its immediate context, never the wider
   relationship around it.
2. Triage it properly: apply one of the defined actions (dismiss with a
   reason, warn, suspend, ban — `platform.moderation_actions`) rather than
   just marking it seen.
3. If the delay was a notification failure, fix that path before closing
   the loop — the next report needs to not repeat this.

## What NOT to do

**Do not bulk-dismiss to clear the queue.** A dismissal requires a real
reason (the future `reporting/03` task's own requirement) — clearing a
backlog by dismissing everything to stop the alert firing is worse than
leaving it open, because a wrongly-dismissed report is a safety issue the
system now believes is resolved.

## Escalation

If reports are aging past 18 hours repeatedly (not a one-off), this is a
capacity problem, not an incident to firefight one report at a time — raise
it as a staffing/process gap rather than continuing to individually triage
under a growing backlog.

## Last exercised

Not yet exercised — cannot be, until `coaching.reports` exists. Revisit and
exercise this runbook in the same PR/phase that builds
`phase-26-trust-and-safety`'s reporting flow (OB§5.3).
