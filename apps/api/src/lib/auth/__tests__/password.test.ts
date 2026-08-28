import { hashPassword, needsRehash, verifyDummyPassword, verifyPassword } from '../password.ts';

describe('hashPassword / verifyPassword', () => {
  it('round-trips: a hashed password verifies against its own plaintext', async () => {
    const digest = await hashPassword('correct horse battery staple');
    await expect(verifyPassword(digest, 'correct horse battery staple')).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const digest = await hashPassword('correct horse battery staple');
    await expect(verifyPassword(digest, 'wrong password entirely')).resolves.toBe(false);
  });

  it('produces a PHC-encoded digest carrying its own algorithm and parameters', async () => {
    const digest = await hashPassword('correct horse battery staple');
    expect(digest).toMatch(/^\$argon2id\$v=\d+\$m=\d+,t=\d+,p=\d+\$/);
  });

  it('rejects a password differing only after byte 72 — no bcrypt-style truncation', async () => {
    const base = 'x'.repeat(72);
    const digest = await hashPassword(`${base}-tail-a`);
    await expect(verifyPassword(digest, `${base}-tail-b`)).resolves.toBe(false);
  });
});

describe('needsRehash', () => {
  it('is false for a digest hashed under the current parameters', async () => {
    const digest = await hashPassword('correct horse battery staple');
    expect(needsRehash(digest)).toBe(false);
  });

  it('is true for a digest hashed under different parameters', async () => {
    // A real PHC string, memory cost deliberately lowered from the current
    // constant (19456) so this reads as "outdated", not "malformed".
    const outdated = '$argon2id$v=19$m=4096,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaGhhc2g';
    expect(needsRehash(outdated)).toBe(true);
  });

  it('is true for a digest that does not parse as Argon2id at all', () => {
    expect(needsRehash('not-a-real-digest')).toBe(true);
  });
});

describe('verifyDummyPassword', () => {
  it('resolves without throwing, regardless of the plaintext given', async () => {
    await expect(verifyDummyPassword('anything at all')).resolves.toBeUndefined();
  });
});
