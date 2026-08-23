// Pure — no Redis, no Postgres. Transcribed straight from CLAUDE.md §6.5;
// change a number in one place and this test is what catches the other
// drifting (`testing` skill §3).
import { RATE_LIMIT_TIERS } from '../trpc/middleware/rate-limit-config.ts';

describe('RATE_LIMIT_TIERS', () => {
  it('auth — 10 / 15 min / IP', () => {
    expect(RATE_LIMIT_TIERS.auth).toEqual({ windowSeconds: 15 * 60, max: 10 });
  });

  it('media.createUploadUrl — 60 / hour / user', () => {
    expect(RATE_LIMIT_TIERS.mediaCreateUploadUrl).toEqual({ windowSeconds: 60 * 60, max: 60 });
  });

  it('nutrition.searchFood — 120 / min / user', () => {
    expect(RATE_LIMIT_TIERS.nutritionSearchFood).toEqual({ windowSeconds: 60, max: 120 });
  });

  it('comments.create — 60 / min / user', () => {
    expect(RATE_LIMIT_TIERS.commentsCreate).toEqual({ windowSeconds: 60, max: 60 });
  });

  it('everything else (default) — 600 / min / user', () => {
    expect(RATE_LIMIT_TIERS.default).toEqual({ windowSeconds: 60, max: 600 });
  });
});
