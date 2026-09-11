import { createHash } from 'node:crypto';
// Type-only, so it is erased before jest's hoist check sees the factory below
// — which rejects any out-of-scope *value* the factory references.
import type * as NodeCrypto from 'node:crypto';

import {
  computeScheduledSessionKey,
  isDerivedSessionKey,
  SESSION_CLIENT_LOCAL_ID_NAMESPACE,
} from '../session-key.ts';

// `expo-crypto`'s digest is a native module. SHA-1 itself is not this
// module's code, so it is supplied by Node's own implementation here — what
// is under test is the byte assembly around it: the namespace bytes, the
// UTF-8 encoding of the name, the version/variant stamping, and the
// formatting. Substituting one conforming SHA-1 for another cannot mask a
// bug in any of those.
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA1: 'SHA-1' },
  digest: async (_algorithm: string, data: Uint8Array): Promise<ArrayBuffer> => {
    // `require` inside the factory: jest hoists `jest.mock` above the
    // imports, so a module-scope binding is not in scope here yet.
    const nodeCrypto = require('node:crypto') as typeof NodeCrypto;
    const hash = nodeCrypto.createHash('sha1').update(Buffer.from(data)).digest();
    return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength) as ArrayBuffer;
  },
}));

const IDENTITY = {
  clientId: '01926b8e-0000-7000-8000-000000000001',
  assignmentId: '01926b8e-0000-7000-8000-000000000002',
  scheduledDate: '2026-08-15',
};

/**
 * An independent RFC 4122 §4.3, written the way the server writes it
 * (`apps/api/src/lib/materialise-sessions.ts`) with Node's `Buffer`. Its
 * whole purpose is to be a SECOND implementation: if this file and
 * `session-key.ts` agree, the device and the server agree, which is the one
 * property that matters (a drift between them silently duplicates a
 * client's workout).
 */
function serverSideUuidV5(clientId: string, assignmentId: string, scheduledDate: string): string {
  const namespaceBytes = Buffer.from(SESSION_CLIENT_LOCAL_ID_NAMESPACE.replace(/-/g, ''), 'hex');
  const nameBytes = Buffer.from(`${clientId}:${assignmentId}:${scheduledDate}`, 'utf8');
  const hash = createHash('sha1').update(namespaceBytes).update(nameBytes).digest();

  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

describe('computeScheduledSessionKey', () => {
  it('matches the server’s derivation byte for byte', async () => {
    const mine = await computeScheduledSessionKey(IDENTITY);

    expect(mine).toBe(
      serverSideUuidV5(IDENTITY.clientId, IDENTITY.assignmentId, IDENTITY.scheduledDate),
    );
  });

  it('pins a fixed vector, so both implementations drifting together is still caught', async () => {
    // Computed independently, outside this suite, straight from RFC 4122
    // §4.3 over the namespace and name bytes. Changing this literal means
    // every scheduled session key in existence has changed, which splits
    // live sessions in two — it is never the right fix for a failing test.
    expect(await computeScheduledSessionKey(IDENTITY)).toBe('6ed84a77-cf78-59b4-b784-49603ac274b5');
  });

  it('produces the same key on every call — this is the whole mechanism', async () => {
    // The two devices in DB§14.5, expressed as two calls.
    const deviceA = await computeScheduledSessionKey(IDENTITY);
    const deviceB = await computeScheduledSessionKey({ ...IDENTITY });

    expect(deviceA).toBe(deviceB);
  });

  it('gives a different day its own key', async () => {
    // Otherwise every session of an assignment would collapse into one row.
    const tuesday = await computeScheduledSessionKey(IDENTITY);
    const wednesday = await computeScheduledSessionKey({
      ...IDENTITY,
      scheduledDate: '2026-08-16',
    });

    expect(tuesday).not.toBe(wednesday);
  });

  it('gives a different client their own key', async () => {
    const mine = await computeScheduledSessionKey(IDENTITY);
    const theirs = await computeScheduledSessionKey({
      ...IDENTITY,
      clientId: '01926b8e-0000-7000-8000-000000000009',
    });

    expect(mine).not.toBe(theirs);
  });

  it('emits a well-formed uuid with the version and variant nibbles set', async () => {
    const key = await computeScheduledSessionKey(IDENTITY);

    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('encodes non-ASCII input the same way the server’s Buffer does', async () => {
    // The hand-rolled UTF-8 encoder exists because React Native has no
    // dependable `TextEncoder`; this is what proves it agrees with one.
    const odd = { ...IDENTITY, scheduledDate: '2026-08-15—ünïcodé-🏋' };

    expect(await computeScheduledSessionKey(odd)).toBe(
      serverSideUuidV5(odd.clientId, odd.assignmentId, odd.scheduledDate),
    );
  });
});

describe('isDerivedSessionKey', () => {
  it('recognises a key this identity derives to', async () => {
    expect(await isDerivedSessionKey(await computeScheduledSessionKey(IDENTITY), IDENTITY)).toBe(
      true,
    );
  });

  it('rejects a random key, which is what an ad-hoc session carries', async () => {
    expect(await isDerivedSessionKey('01926b8e-0000-7000-8000-0000000000ff', IDENTITY)).toBe(false);
  });

  it('treats a missing key as not derived rather than throwing', async () => {
    expect(await isDerivedSessionKey(null, IDENTITY)).toBe(false);
  });
});
