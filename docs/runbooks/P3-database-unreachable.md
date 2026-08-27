# P3 — Database unreachable

## What this means

`service.db_reachable` reported `0` — `pingDb` (`packages/db/src/client.ts`)
timed out or errored against the primary Postgres instance within its 250ms
budget. Every read and write in the product depends on this database; there
is no degraded mode. `GET /ready` will also be reporting `db: "degraded"`
and returning 503, which takes every instance out of a load balancer's
rotation.

## First three checks

1. Neon's (dev) or RDS's (prod) own status/console — is the instance itself
   reported down, or is this a network-path problem from the API host?
2. `GET /ready` from the API host directly (not through a CDN/proxy) — does
   it reproduce, or is this specific to one instance?
3. Check whether `DATABASE_URL` or its credentials rotated recently — an
   auth failure and a genuine outage look identical from `pingDb`'s
   perspective (both time out or error), but have very different fixes.

## Likely causes

Ranked by frequency:

1. The managed Postgres provider (Neon free tier autosuspends after
   inactivity — CLAUDE.md §3.4.3) is cold-starting; the first connection
   after a suspend can exceed `pingDb`'s 250ms budget even though the
   database itself is fine seconds later.
2. A genuine provider outage (rare, but check their status page before
   assuming anything else).
3. Connection pool exhaustion on the API side — `createDbClient`'s
   `maxConnections` (default 10, `packages/db/src/client.ts`) is sized for
   a single small VPS; a leak or a burst of long-running queries can
   saturate it.
4. Credential rotation without updating the running process's env var.

## What to do

1. Confirm this is a real outage and not a false positive from Neon
   autosuspend (check 1 above) — if it's autosuspend, a second `GET /ready`
   30 seconds later resolving on its own confirms it and needs no further
   action.
2. If genuinely down, check the provider's status page and any incident
   communication before acting — a provider-side outage has no fix on our
   side beyond waiting, and treating it as ours to fix wastes the time that
   matters.
3. If the provider reports healthy but connections still fail, check pool
   exhaustion (`pg_stat_activity` if reachable at all, or the provider's own
   connection-count graph) and consider restarting the API process to
   release a leaked pool before anything more invasive.
4. Communicate status (internally, and to pilot coaches if this crosses
   `docs/PILOT-PLAYBOOK.md` PI§4.1's same-day threshold) before attempting a
   restore.

## What NOT to do

**Do not restore from backup until you have confirmed the primary is
genuinely gone**, not just unreachable. A restore replaces the live database
with the last snapshot (CLAUDE.md §21.2: 30-day PITR + 12 monthly
snapshots) — running it over a database that was actually just slow to
respond, or suffering a transient network partition, **loses every write
made since that snapshot** for no reason. Confirm total, sustained
unreachability (not just one failed `pingDb` call) before this becomes an
option at all.

## Escalation

If the database is confirmed genuinely gone (not autosuspend, not a
transient network blip, and the provider confirms an outage or data loss)
and a restore is the only path forward, stop and get a second person to
confirm the decision before running it — a restore is the one action in
this runbook that cannot be undone by a later runbook.

## Last exercised

Not yet exercised against staging (OB§5.3) — this one specifically requires
an actual restore drill (`ARCHITECTURE-ESSENTIALS.md` E§37e), not just a
read of this document. Schedule it before ship-gate-1's pilot begins
(`docs/PILOT-PLAYBOOK.md`).
