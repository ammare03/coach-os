import { parseDeepLink } from '../parse.ts';

// `deep-linking/02`'s Verification section: a range of well-formed and
// malformed URLs in both forms, asserting correct extraction or a graceful
// `null` for each.

describe('parseDeepLink', () => {
  it('parses the scheme form', () => {
    expect(parseDeepLink('coachos://invite/ABC123')).toEqual({
      segments: ['invite', 'ABC123'],
      query: '',
    });
  });

  it('parses the universal-link form to the same shape', () => {
    expect(parseDeepLink('https://app.coachos.com/invite/ABC123')).toEqual(
      parseDeepLink('coachos://invite/ABC123'),
    );
  });

  it('treats coachos:// and coachos:/// as the same link', () => {
    expect(parseDeepLink('coachos:///invite/ABC123')).toEqual(
      parseDeepLink('coachos://invite/ABC123'),
    );
  });

  it('parses the dev-client tunnel form every local test arrives as', () => {
    expect(parseDeepLink('exp://192.168.1.4:8081/--/invite/ABC123')).toEqual(
      parseDeepLink('coachos://invite/ABC123'),
    );
  });

  it('keeps the query string and drops the fragment', () => {
    expect(parseDeepLink('https://app.coachos.com/chat/c1?from=push#top')).toEqual({
      segments: ['chat', 'c1'],
      query: 'from=push',
    });
  });

  it('decodes percent-encoded segments', () => {
    expect(parseDeepLink('coachos://invite/a%2Fb')?.segments).toEqual(['invite', 'a/b']);
  });

  it('ignores the host casing on a universal link', () => {
    expect(parseDeepLink('https://APP.CoachOS.com/invite/ABC')?.segments).toEqual([
      'invite',
      'ABC',
    ]);
  });

  it.each([
    ['a foreign host', 'https://evil.example.com/invite/ABC'],
    ['the marketing host', 'https://coachos.com/invite/ABC'],
    ["another app's scheme", 'othertapp://invite/ABC'],
    ['the dev-client launcher URL', 'exp+coachos://expo-development-client/?url=http%3A%2F%2Fx'],
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['a truncated percent escape', 'coachos://invite/AB%'],
  ])('returns null for %s', (_label, url) => {
    expect(parseDeepLink(url)).toBeNull();
  });

  it('returns an empty path rather than null for a bare scheme launch', () => {
    expect(parseDeepLink('coachos://')).toEqual({ segments: [], query: '' });
  });

  it('never throws, whatever arrives', () => {
    const nasty = ['//', '?', '#', ':::', 'https://', 'coachos://%%%/%', '/a//b///c'];
    for (const url of nasty) {
      expect(() => parseDeepLink(url)).not.toThrow();
    }
  });

  it('drops empty segments from a doubled slash', () => {
    expect(parseDeepLink('coachos://a//b///c')?.segments).toEqual(['a', 'b', 'c']);
  });
});
