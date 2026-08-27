# P5 — Suspected data leak

## What this means

Someone reported seeing another user's data — a coach seeing another
coach's client, a client seeing another client's messages or media, or
anything in that shape. This is treated as a live breach the moment it's
reported, not after it's confirmed (`SUPPORT.md` SU§7) — the cost of
treating a false alarm as real is small; the cost of treating a real breach
as a "probably a display bug" is not.

**Not a polled metric.** Unlike P1–P3, nothing in `metrics-collector.ts`
computes this — OB§4.1's own wording is "any **report**", i.e. a human
filing one, not a threshold on a number. `apps/api/src/lib/alerts.ts`'s
`dispatchAlert` is ready to send this the moment a caller raises it with
`{ alertId: 'P5', summary }`; today, that caller is a human going through
this runbook manually, and in the future the trust-and-safety reporting flow
(`phase-26-trust-and-safety`) will call it directly the instant a report is
tagged with this severity.

## First three checks

1. **Do not touch the reporter's or the implicated account yet.** First
   confirm you can see what they described: does the exact reported view
   (screenshot, description, or a reproduction with a test account) actually
   show cross-account data?
2. Check `audit_log` for both accounts around the reported time —
   `SELECT * FROM platform.audit_log WHERE actor_user_id IN ($reporter, $implicated) ORDER BY created_at DESC LIMIT 50;`
   — does anything explain it (a shared device, a session that wasn't
   signed out, an actual authorization bug)?
3. If it's reproducible, identify which procedure returned the wrong data —
   this narrows "authorization bug" to a specific `ownsResource` gap
   (`CLAUDE.md` §6.2) versus a client-side caching bug (stale data rendered
   from a previous, different account's session on a shared device).

## Likely causes

1. A client-side cache (TanStack Query, a local SQLite row) not cleared on
   sign-out, showing a previous account's stale data to whoever signs in
   next on the same device.
2. A genuine `ownsResource` gap — a procedure missing the authorization
   check CLAUDE.md §6.2 requires on every `clientId`-scoped resource.
3. A signed URL (R2 media) that leaked or was shared beyond its intended
   short expiry.
4. The reporter misidentified what they saw (still treat as real until
   checks 1–2 rule it out — never assume this first).

## What to do

1. Preserve evidence first: export the relevant `audit_log` rows and the
   report itself before anything else changes state.
2. If it reproduces and points at a real authorization gap, patch it as the
   highest-priority fix in the codebase — ahead of any other in-flight
   work.
3. Determine blast radius: is this one account pair, or does the same
   authorization gap expose every account? Query for how many other
   requests hit the same vulnerable code path.
4. Notify affected users only once you know what actually happened and what
   you did about it — not before, and not with speculation.
5. Follow `COMPLIANCE.md` CO§6's breach process in parallel with the
   technical fix, starting immediately — its clock starts on discovery, not
   on confirmation.

## What NOT to do

**Do not touch the account** — don't suspend it, don't message the user,
don't poke around in it beyond what's needed to confirm the report — until
you understand what happened; premature action can destroy the evidence of
how the leak occurred. **Preserve logs and `audit_log` first.** Do not tell
the reporter it was "probably a display bug" before you actually know —
that is the single most damaging thing to say if it turns out to be real,
and it costs nothing to instead say "we're investigating" while you check.
**Follow `COMPLIANCE.md` CO§6's breach process on its own clock** — this is
a legal timeline, not an operational one, and treating it as "we'll loop in
compliance once we're sure" is itself the mistake.

## Escalation

This alert has no "wait and see" tier — every occurrence gets the full
process above immediately. If you cannot rule out real cross-account
exposure within an hour of the report, treat it as confirmed for compliance
purposes (CO§6) even while the technical investigation continues; the legal
clock does not wait for certainty.

## Last exercised

Not yet exercised against staging (OB§5.3). Schedule the first walk-through
before ship-gate-1's pilot begins (`docs/PILOT-PLAYBOOK.md`).
