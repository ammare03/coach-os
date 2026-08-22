// Every table's `id` column defaults to `uuidv7()` (`_shared.ts`), which
// embeds the real wall-clock time plus random bits — exactly right for
// production inserts (DB§2's time-ordered-index rationale), and exactly
// wrong for a seed script that DB§21 requires to be "byte-identical across
// machines." Relying on that default would make every `pnpm db:seed` run
// produce different primary keys even with `faker.seed(42)` fixed.
//
// The fix: every row this seed inserts gets its `id` explicitly, generated
// here as a UUIDv5 (RFC 4122 §4.3 — a hash of a fixed namespace plus a
// caller-supplied name, so the SAME name always yields the SAME uuid,
// forever, on any machine). No new dependency — this is ~20 lines against
// Node's built-in `crypto`, not the `uuid` npm package, keeping with
// CLAUDE.md §3.4's "free/already-available before a new package" order.
//
// The determinism this buys is only as good as the `key` strings callers
// pass in. Every seed module MUST derive its keys from stable, semantic
// identifiers — `'client:2'`, `'exercise:barbell-back-squat'`,
// `'session:client:2:w3:d1'` — never from anything that varies run to run
// (a random number, `Date.now()`, insertion order that could shift if a
// module is reordered). Two different rows must never produce the same
// key, and the same row must never be reachable by two different keys.
import { createHash } from 'node:crypto';

// A fixed, arbitrary namespace UUID scoped to this seed script only — never
// reused for anything else, so seed-generated ids can never collide with a
// real UUIDv7 row id (whose version nibble is always 7, never 5) or with
// another namespace's UUIDv5 space. Generated once and frozen; changing
// this value would change every seeded id on the next run, which is exactly
// the kind of accidental non-determinism this file exists to prevent.
const SEED_NAMESPACE = '2a9e6b3e-9b8b-5f1e-8c2a-8f6f2e6b7a10';

function parseUuid(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Deterministic UUIDv5(SEED_NAMESPACE, key). Same `key` in → same uuid out,
 * on every machine, forever. Use this for every `id` column this seed
 * script writes — never the table's own `$defaultFn(uuidv7)` default.
 */
export function seedId(key: string): string {
  const namespaceBytes = parseUuid(SEED_NAMESPACE);
  const nameBytes = Buffer.from(key, 'utf8');
  const hash = createHash('sha1').update(namespaceBytes).update(nameBytes).digest();

  // RFC 4122 §4.3: take the first 16 bytes of the hash, then stamp the
  // version (5) and variant (RFC 4122) bits over the relevant nibbles.
  // `readUInt8`/`writeUInt8`, not bracket indexing — `noUncheckedIndexedAccess`
  // types Buffer's index signature as `number | undefined`, and these two
  // methods are the non-`!` way to read/write a known-in-range byte.
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6); // version 5
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8); // variant RFC 4122

  return formatUuid(bytes);
}
