-- drizzle:non-transactional
-- DB§14.1's missing idempotency index for `coaching.body_metrics`, a DB§14.3
-- device-wins table. CONCURRENTLY (db-migrations §4/§6): a plain build takes
-- a SHARE lock and blocks every write to the table for its duration.
-- Partial, because `client_local_id` is nullable — a check-in-sourced metric
-- never passes through the outbox and carries no key.
CREATE UNIQUE INDEX CONCURRENTLY "body_metrics_client_local" ON "coaching"."body_metrics" USING btree ("client_id","client_local_id") WHERE "coaching"."body_metrics"."client_local_id" IS NOT NULL;
