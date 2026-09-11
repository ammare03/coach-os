import { digest, CryptoDigestAlgorithm } from 'expo-crypto';

// DB§14.5 mechanism 1, on the device — the deterministic session key
// (`phase-09-workout-logger/session-runtime/08`), and the derivation
// `lib/outbox/enqueue.ts` names this task as the owner of.
//
// **Why a key can be derived at all.** Every other offline-capable write
// generates a random UUIDv7 at the moment the user acts (DB§14.1), and two
// devices therefore produce two keys for one real-world thing. For a
// SCHEDULED session that is a bug with no cure downstream: the unique index
// cannot merge two rows whose keys genuinely differ, and the client ends up
// with Tuesday's workout twice on their coach's dashboard, doubled volume,
// and two rows nothing can tell apart afterwards.
//
// A scheduled session has a natural identity — this client, this
// assignment, this local calendar day — so the key is *derived* from it
// rather than invented. Both devices compute the same value and the
// existing upsert merges them, with no new machinery at all.
//
// **Ad-hoc sessions keep a random key, deliberately** (DB§14.5). There is
// nothing to derive from, and two unplanned workouts on one day is a
// legitimate thing a person does — collapsing them would be the opposite
// bug. `hooks/useStartAdHocSession.ts` is where that stays.
//
// ── Two things this module is not ────────────────────────────────────────
//
// **It is not what puts the key on a scheduled row today.** The server
// materialises assigned sessions with this exact value already
// (`apps/api/src/lib/materialise-sessions.ts`), and `lib/prefetch/sessions.ts`
// copies it to the device, so both devices agree before either one opens
// the app. This is the device-side half of the same formula, for the paths
// that need to compute rather than read it: a session created on device
// against a known assignment, and any future `workouts.upsertSession` whose
// conflict target is `(client_id, client_local_id)`.
//
// **It is not a general-purpose uuidv5.** {@link SESSION_CLIENT_LOCAL_ID_NAMESPACE}
// is scoped to `training.workout_sessions.client_local_id` and nothing else,
// matching the server constant's own reservation. A second use case mints a
// second namespace.
//
// ── The contract that matters ────────────────────────────────────────────
//
// **This must stay bit-for-bit identical to the server's
// `computeSessionClientLocalId`.** They are two implementations of RFC 4122
// §4.3 in two runtimes — Node's `crypto`/`Buffer` there, `expo-crypto` and
// hand-rolled UTF-8 here, because React Native has neither. A drift between
// them is silent and produces exactly the duplicate this whole mechanism
// exists to prevent, so `__tests__/session-key.test.ts` pins the output
// against fixed vectors rather than against a re-implementation.

/**
 * The fixed namespace, copied verbatim from
 * `apps/api/src/lib/materialise-sessions.ts`. Copied rather than imported:
 * that module pulls in `node:crypto` and the Drizzle schema, neither of
 * which can cross into the Metro bundle (`code-conventions` §3's
 * `verbatimModuleSyntax` note, and `lib/trpc.ts`'s own type-only import for
 * the same reason). The test pins the value.
 */
export const SESSION_CLIENT_LOCAL_ID_NAMESPACE = '7c1d9f2a-4e6b-5a3c-8d21-0f7b6c9e4a52';

/**
 * UTF-8 bytes, hand-rolled. `TextEncoder`'s availability varies across
 * Hermes versions and this value must be identical on every device forever,
 * so it is computed rather than delegated. Surrogate pairs are handled;
 * lone surrogates become U+FFFD, matching what a conforming encoder does.
 */
function utf8Bytes(value: string): Uint8Array {
  const out: number[] = [];

  for (let i = 0; i < value.length; i += 1) {
    let code = value.charCodeAt(i);

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      } else {
        code = 0xfffd;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = 0xfffd;
    }

    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }

  return Uint8Array.from(out);
}

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) throw new Error('session-key: namespace is not a uuid');

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToUuid(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

export interface ScheduledSessionIdentity {
  /** `client_profiles.id` — the session's owner, half of the unique index. */
  clientId: string;
  /** `assignments.id`. A session with no assignment is ad-hoc and has no derivable key. */
  assignmentId: string;
  /** The client's own local calendar day, `yyyy-MM-dd` (`code-conventions` §6). */
  scheduledDate: string;
}

/**
 * `uuidv5(SESSION_CLIENT_LOCAL_ID_NAMESPACE, "clientId:assignmentId:scheduledDate")`
 * — DB§14.5's exact formula, and byte-identical to the server's.
 *
 * RFC 4122 §4.3: SHA-1 over the namespace bytes followed by the name bytes,
 * with the version and variant nibbles stamped over the first 16 bytes of
 * the hash.
 *
 * Async because `expo-crypto`'s digest is; there is no synchronous SHA-1 in
 * the runtime and hand-rolling one would be a second implementation of a
 * primitive to keep bit-identical, which is the failure this module is
 * built to avoid.
 */
export async function computeScheduledSessionKey(
  identity: ScheduledSessionIdentity,
): Promise<string> {
  const namespace = uuidToBytes(SESSION_CLIENT_LOCAL_ID_NAMESPACE);
  const name = utf8Bytes(`${identity.clientId}:${identity.assignmentId}:${identity.scheduledDate}`);

  const message = new Uint8Array(namespace.length + name.length);
  message.set(namespace, 0);
  message.set(name, namespace.length);

  const hashed = new Uint8Array(await digest(CryptoDigestAlgorithm.SHA1, message));
  const bytes = hashed.slice(0, 16);

  // `noUncheckedIndexedAccess` — a 16-byte slice of a 20-byte SHA-1 digest
  // always has these, but the compiler cannot see that.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; // version 5
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant RFC 4122

  return bytesToUuid(bytes);
}

/**
 * Whether a stored key is the one this identity derives to.
 *
 * The use is diagnostic, never corrective: a mismatch means the row predates
 * the deterministic scheme or was written by a path that did not derive, and
 * **rewriting the key would be far worse than leaving it** — it is half the
 * conflict target of every upsert against that row, and moving it splits one
 * session into two, which is the exact outcome this file exists to prevent.
 */
export async function isDerivedSessionKey(
  storedKey: string | null,
  identity: ScheduledSessionIdentity,
): Promise<boolean> {
  if (storedKey === null) return false;
  return storedKey === (await computeScheduledSessionKey(identity));
}
