// Argon2id hashing — CLAUDE.md §21.2. `@node-rs/argon2` (Rust via napi-rs,
// prebuilt binaries for every platform this repo builds on — no node-gyp
// toolchain, unlike the plain `argon2` package, and no pure-JS fallback
// slow enough to tempt lowering the cost parameters — `01`'s Approach step
// 2). Nothing else in the codebase calls `@node-rs/argon2` directly.
import { hash, verify } from '@node-rs/argon2';

// `@node-rs/argon2` declares `Algorithm` as an ambient `const enum`, which
// `verbatimModuleSyntax` (this repo's TS config) refuses to import across a
// module boundary — the compiler can't inline its values without emitting a
// type-only import that would then have no runtime representation. `2` is
// `Algorithm.Argon2id`'s own ordinal (`Argon2d = 0, Argon2i = 1, Argon2id =
// 2`, checked directly in the package's `.d.ts`) — named here instead of a
// bare magic number for the same reason every other constant in this file
// is.
const ARGON2ID = 2;

// OWASP Password Storage Cheat Sheet, Argon2id minimum configuration
// (checked 2026-08-27): m=19456 (19 MiB), t=2, p=1. These happen to be
// `@node-rs/argon2`'s own defaults too, but declared explicitly rather than
// relied on — a library changing its defaults must not silently change our
// security floor.
const MEMORY_COST_KIB = 19_456;
const TIME_COST = 2;
const PARALLELISM = 1;

const HASH_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: MEMORY_COST_KIB,
  timeCost: TIME_COST,
  parallelism: PARALLELISM,
} as const;

/**
 * A fixed dummy digest, hashed once at module load, for `verifyPassword` to
 * run against when there is no real user row — `02`'s Approach step 3.
 * Skipping verification entirely on an unknown email returns in ~1ms where
 * a real check takes tens of milliseconds; that gap is measurable over a
 * few hundred requests and confirms an email has no account.
 */
const DUMMY_DIGEST = hash('a fixed plaintext, never a real password', HASH_OPTIONS);

/** Hashes a plaintext password into a self-describing PHC string — the
 * returned digest carries its own algorithm, version, and cost parameters,
 * which is what makes {@link needsRehash} possible with no separate column
 * recording what was used when a row was created. */
export function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, HASH_OPTIONS);
}

/**
 * Verifies a plaintext password against a stored digest. `@node-rs/argon2`
 * reads the algorithm/parameters/salt out of the PHC string itself — the
 * `HASH_OPTIONS` constants above are irrelevant to verification and are not
 * passed here, deliberately, so a digest hashed under an older parameter
 * set still verifies correctly against its own embedded parameters.
 */
export function verifyPassword(digest: string, plaintext: string): Promise<boolean> {
  return verify(digest, plaintext);
}

/**
 * Runs a real Argon2id verification against a fixed dummy digest so an
 * unknown-email sign-in costs the same CPU time as a real one. The boolean
 * result is meaningless — the caller already knows there is no user to
 * match — this exists purely to keep the two code paths' timing
 * indistinguishable (`02`'s Approach step 3, Risks: "enumeration resistance
 * decays").
 */
export async function verifyDummyPassword(plaintext: string): Promise<void> {
  await verify(await DUMMY_DIGEST, plaintext);
}

const PHC_PARAMS = /^\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/;

/**
 * True when `digest` was hashed with different parameters than
 * {@link HASH_OPTIONS} currently specifies — a raised cost floor (or a
 * digest from before this file existed) should upgrade on the next
 * successful sign-in (`02`'s Approach step 7), since a plaintext password
 * is only ever available at the moment of verification.
 *
 * A digest that isn't Argon2id at all, or doesn't parse, is treated as
 * needing a rehash too — the safe direction, since the alternative is
 * silently leaving a weaker hash in place forever.
 */
export function needsRehash(digest: string): boolean {
  const match = PHC_PARAMS.exec(digest);
  if (!match) {
    return true;
  }
  const [, memoryCost, timeCost, parallelism] = match;
  return (
    Number(memoryCost) !== MEMORY_COST_KIB ||
    Number(timeCost) !== TIME_COST ||
    Number(parallelism) !== PARALLELISM
  );
}
