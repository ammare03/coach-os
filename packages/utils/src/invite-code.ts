// The invite code generator (`invites/03`, `DATABASE.md` DB§5.1's comment on
// `identity.invites.code`): 8 characters, drawn from a 32-character alphabet
// with every visually-ambiguous character removed outright — no digit `0`,
// no letter `O`, no digit `1`, no letter `I` — because a client types this
// off a screen or reads it aloud, unlike most ids in this product.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 32 chars: 2-9, A-Z minus I/O
const CODE_LENGTH = 8;

/**
 * `globalThis.crypto.getRandomValues`, not `Math.random()` (unsuitable for
 * anything collision-sensitive) and not `node:crypto` (`packages/utils`
 * carries no Node-builtin import — `code-conventions` skill §1's package
 * table). Web Crypto is a global in both this package's runtimes (Node 22,
 * and Hermes via React Native's polyfill), so this stays a pure function
 * with no I/O. 256 (a byte's range) divides evenly by 32 (the alphabet's
 * length), so `% ALPHABET.length` introduces no modulo bias.
 *
 * Collision resistance, not secrecy, is what this needs — `invites/01`'s
 * insert retries on a `invites_code_unique` violation rather than trusting
 * generation alone (the database is the real collision guard); this
 * function only needs to make that retry rare.
 */
export function generateInviteCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  globalThis.crypto.getRandomValues(bytes);

  let code = '';
  for (const byte of bytes) {
    code += ALPHABET[byte % ALPHABET.length];
  }
  return code;
}
