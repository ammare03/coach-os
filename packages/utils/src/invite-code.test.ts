import { generateInviteCode } from './invite-code.ts';

const EXCLUDED_CHARS = ['0', 'O', '1', 'I'];
const SAMPLE_SIZE = 5000;

describe('generateInviteCode', () => {
  it('produces exactly 8 characters', () => {
    expect(generateInviteCode()).toHaveLength(8);
  });

  it('never contains an ambiguous character (0/O, 1/I)', () => {
    for (let i = 0; i < SAMPLE_SIZE; i++) {
      const code = generateInviteCode();
      for (const excluded of EXCLUDED_CHARS) {
        expect(code).not.toContain(excluded);
      }
    }
  });

  it('draws every character from the documented 32-character alphabet', () => {
    const alphabet = new Set('23456789ABCDEFGHJKLMNPQRSTUVWXYZ'.split(''));
    for (let i = 0; i < SAMPLE_SIZE; i++) {
      for (const char of generateInviteCode()) {
        expect(alphabet.has(char)).toBe(true);
      }
    }
  });

  it('produces effectively unique codes across a large sample', () => {
    const codes = new Set(Array.from({ length: SAMPLE_SIZE }, () => generateInviteCode()));
    // 32^8 possible codes — a collision in a 5,000-sample draw is
    // astronomically unlikely unless generation is broken (e.g. a fixed
    // seed, a narrowed alphabet). A real, rare collision failing this test
    // is an acceptable trade for catching a broken generator deterministically.
    expect(codes.size).toBe(SAMPLE_SIZE);
  });
});
