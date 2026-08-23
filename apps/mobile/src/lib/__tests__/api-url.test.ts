import { resolveApiUrl } from '../api-url.ts';

describe('resolveApiUrl', () => {
  it('derives the origin from the dev-server host in development', () => {
    const url = resolveApiUrl({
      isDev: true,
      hostUri: '192.168.1.5:8081',
      configuredUrl: undefined,
    });
    expect(url).toBe('http://192.168.1.5:3000/trpc');
  });

  it('falls back to EXPO_PUBLIC_API_URL in development when no dev-server host is available', () => {
    const url = resolveApiUrl({
      isDev: true,
      hostUri: undefined,
      configuredUrl: 'https://staging-api.coachos.app',
    });
    expect(url).toBe('https://staging-api.coachos.app/trpc');
  });

  it('uses EXPO_PUBLIC_API_URL verbatim in preview/production', () => {
    const url = resolveApiUrl({
      isDev: false,
      hostUri: '192.168.1.5:8081',
      configuredUrl: 'https://api.coachos.app',
    });
    expect(url).toBe('https://api.coachos.app/trpc');
  });

  it('never produces a double slash before /trpc when EXPO_PUBLIC_API_URL has a trailing slash', () => {
    const url = resolveApiUrl({
      isDev: false,
      hostUri: undefined,
      configuredUrl: 'https://api.coachos.app/',
    });
    expect(url).toBe('https://api.coachos.app/trpc');
  });

  it('throws when no URL can be resolved at all', () => {
    expect(() =>
      resolveApiUrl({ isDev: false, hostUri: undefined, configuredUrl: undefined }),
    ).toThrow();
  });
});
