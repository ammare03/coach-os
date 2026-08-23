// One valid case, one invalid case per shape (CLAUDE.md §18.1), plus the
// three behaviours `03-validation-conventions.md` calls out by name: the
// cap is a rejection, not a clamp; the envelope's key is `nextCursor`,
// verbatim, forever; and it's the child schema — not the shared cursor —
// that fails when a caller sends garbage.
import { z } from 'zod';

import { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from '../limits.ts';
import { pageOf, paginationInput } from '../pagination.ts';

describe('paginationInput', () => {
  it('defaults limit to DEFAULT_PAGE_SIZE when omitted', () => {
    expect(paginationInput.parse({})).toMatchObject({ limit: DEFAULT_PAGE_SIZE });
  });

  it('accepts an explicit cursor and limit', () => {
    const result = paginationInput.parse({ cursor: '2026-08-21T00:00:00.000Z', limit: 50 });
    expect(result).toMatchObject({ cursor: '2026-08-21T00:00:00.000Z', limit: 50 });
  });

  it('rejects a limit above MAX_PAGE_SIZE — a cap, not a clamp', () => {
    const result = paginationInput.safeParse({ limit: MAX_PAGE_SIZE + 1 });
    expect(result.success).toBe(false);
  });

  it('rejects a limit below 1', () => {
    expect(paginationInput.safeParse({ limit: 0 }).success).toBe(false);
  });

  it('rejects an unknown key — strict, like every other input schema', () => {
    expect(paginationInput.safeParse({ limit: 10, offset: 20 }).success).toBe(false);
  });
});

describe('pageOf', () => {
  const page = pageOf(z.object({ id: z.string() }));

  it('accepts an envelope of items with a cursor', () => {
    const result = page.safeParse({ items: [{ id: 'a' }], nextCursor: '2026-08-21T00:00:00.000Z' });
    expect(result.success).toBe(true);
  });

  it('accepts a null nextCursor — the last page', () => {
    expect(page.safeParse({ items: [], nextCursor: null }).success).toBe(true);
  });

  it("rejects an item that fails the caller's own item schema", () => {
    expect(page.safeParse({ items: [{ id: 5 }], nextCursor: null }).success).toBe(false);
  });
});
