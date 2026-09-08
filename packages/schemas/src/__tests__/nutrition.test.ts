import { MAX_MY_FOODS_LIMIT, myFoodsInput } from '../nutrition.ts';

describe('myFoodsInput', () => {
  it('defaults to the 100 foods CLAUDE.md §11.2 asks for', () => {
    expect(myFoodsInput.parse({})).toEqual({ limit: 100 });
  });

  it('accepts a caller-chosen limit up to the cache ceiling', () => {
    expect(myFoodsInput.parse({ limit: MAX_MY_FOODS_LIMIT })).toEqual({
      limit: MAX_MY_FOODS_LIMIT,
    });
  });

  it('rejects a limit past the ceiling rather than clamping it', () => {
    expect(() => myFoodsInput.parse({ limit: MAX_MY_FOODS_LIMIT + 1 })).toThrow();
  });

  it('rejects a fractional or zero limit', () => {
    expect(() => myFoodsInput.parse({ limit: 0 })).toThrow();
    expect(() => myFoodsInput.parse({ limit: 10.5 })).toThrow();
  });

  it('rejects an unknown key rather than silently dropping it', () => {
    expect(() => myFoodsInput.parse({ limit: 10, clientId: 'someone-else' })).toThrow();
  });
});
