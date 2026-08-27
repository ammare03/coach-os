# P2 — API down / error storm

## What this means

`service.error_rate_5m` was above 25% over a 5-minute window with at least
20 requests in it (`apps/api/src/jobs/alert-evaluator.ts`'s
`MIN_REQUESTS_FOR_ERROR_RATE`, so this never fires on one or two unlucky
calls). Every coach and client currently using the app is seeing failures on
a meaningful fraction of their requests — logging a set, sending a message,
opening the dashboard.

## First three checks

1. `GET /health` — does the process respond at all? If not, this is a crash
   loop or the process is down, not a partial degradation; go straight to
   "roll back" below.
2. `GET /ready` — is Postgres or Redis reported degraded? If yes, this may
   actually be a P3 (database unreachable) surfacing as elevated errors
   here first; check `service.db_reachable` on `GET /internal/metrics`.
3. Search the structured logs for `request.uncaught_error` in the last 10
   minutes, grouped by `procedure` — is it one procedure (a bad deploy
   touching one code path) or spread across many (infrastructure, not
   code)?

## Likely causes

Ranked by frequency:

1. A just-deployed change introduced a bug that throws on a common input
   shape — check `git log` for anything merged in the last hour.
2. A dependency (Postgres, Redis, R2, LiveKit, RevenueCat) is down or
   rate-limiting the API — cross-reference `GET /ready` and the specific
   provider's own status page.
3. A traffic spike beyond what the current instance size handles (unlikely
   pre-launch, but check anyway before assuming code).
4. `INTERNAL_JOB_SECRET` or another required env var missing/rotated after
   a redeploy, causing every request through a code path that reads it to
   throw.

## What to do

1. Identify whether the error storm started at a deploy timestamp
   (`git log`, EAS/Fly deploy history) or independently of one.
2. If it lines up with a deploy: **roll back to the previous release
   immediately.**
3. If it does not line up with a deploy: check the dependency in question
   (§ First three checks, item 2) and follow the _matching_ runbook (P3 if
   it's the database) instead of this one.
4. Once rolled back or the dependency recovers, confirm
   `service.error_rate_5m` drops on the next collection run
   (`GET /internal/metrics`) before considering this resolved.
5. Only after the immediate fire is out, diagnose the actual code defect in
   a branch, with tests, through the normal PR process.

## What NOT to do

**Do not roll forward with a fix.** Diagnosing and patching under pressure,
live, while the API is actively failing for real users, is how a 5-minute
outage becomes a 45-minute one with a second bug layered on top. **Roll back
first, diagnose second** — a previous known-good version is always faster to
restore than a new fix is to get right the first time.

## Escalation

If rolling back does not bring `service.error_rate_5m` down within one
collection cycle, the cause is not the last deploy — stop and treat it as
infrastructure (move to the P3 runbook if Postgres/Redis is implicated, or
check the hosting provider's own status page) rather than trying a second
rollback.

## Last exercised

Not yet exercised against staging (OB§5.3). Schedule the first walk-through
before ship-gate-1's pilot begins (`docs/PILOT-PLAYBOOK.md`).
