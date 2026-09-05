import { resolveDeepLink } from '../link-table.ts';
import { parseDeepLink } from '../parse.ts';

// `deep-linking/02`'s half of the table: the machinery and the one row that
// is already live. The seven §9.3 rows are asserted in `link-table-9-3.test.ts`
// (`deep-linking/03`).

function resolve(url: string, role: Parameters<typeof resolveDeepLink>[1] = null) {
  const link = parseDeepLink(url);
  expect(link).not.toBeNull();
  // Guarded immediately above — the `?? ` keeps the assertion honest without
  // a non-null assertion (`code-conventions` §3).
  return resolveDeepLink(link ?? { segments: [], query: '' }, role);
}

describe('resolveDeepLink', () => {
  it('resolves the reset-password link with no session at all', () => {
    expect(resolve('https://app.coachos.com/reset-password/tok-123')).toEqual({
      status: 'resolved',
      href: '/(auth)/reset-password/tok-123',
    });
  });

  it('resolves the same link from the scheme form', () => {
    expect(resolve('coachos://reset-password/tok-123')).toEqual(
      resolve('https://app.coachos.com/reset-password/tok-123'),
    );
  });

  it('re-encodes a dynamic segment so it stays one route param', () => {
    expect(resolve('coachos://reset-password/a%2Fb')).toEqual({
      status: 'resolved',
      href: '/(auth)/reset-password/a%2Fb',
    });
  });

  it('carries the query string through', () => {
    expect(resolve('coachos://reset-password/tok?src=email')).toEqual({
      status: 'resolved',
      href: '/(auth)/reset-password/tok?src=email',
    });
  });

  it('leaves an unknown first segment unhandled', () => {
    expect(resolve('coachos://not-a-link/1').status).toBe('unhandled');
  });

  it('leaves an empty path unhandled', () => {
    expect(resolveDeepLink({ segments: [], query: '' }, null).status).toBe('unhandled');
  });

  it('leaves a link missing its dynamic segment unhandled', () => {
    expect(resolve('coachos://reset-password').status).toBe('unhandled');
  });

  it('leaves a link with an extra segment unhandled', () => {
    expect(resolve('coachos://reset-password/tok/extra').status).toBe('unhandled');
  });
});
