import { deriveClientSeatLimit } from './seat-limit.ts';

describe('deriveClientSeatLimit', () => {
  it.each([
    ['starter', 0, 2],
    ['coach', 0, 10],
    ['pro', 0, 30],
    ['studio', 0, 75],
  ] as const)('%s tier with no seat packs is %i seats', (tier, seatPacks, expected) => {
    expect(deriveClientSeatLimit(tier, seatPacks)).toBe(expected);
  });

  it.each([
    ['starter', 1, 7],
    ['coach', 2, 20],
    ['pro', 3, 45],
  ] as const)('%s tier with %i seat pack(s) adds 5 seats each', (tier, seatPacks, expected) => {
    expect(deriveClientSeatLimit(tier, seatPacks)).toBe(expected);
  });

  it('returns Infinity for agency regardless of seat packs', () => {
    expect(deriveClientSeatLimit('agency', 0)).toBe(Infinity);
    expect(deriveClientSeatLimit('agency', 3)).toBe(Infinity);
  });
});
