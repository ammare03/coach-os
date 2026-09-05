import { parseMobileEnv } from '../env.ts';

const DEFAULT_HOST = 'https://us.i.posthog.com';

describe('parseMobileEnv', () => {
  it('reads a configured PostHog key', () => {
    expect(
      parseMobileEnv({ EXPO_PUBLIC_POSTHOG_KEY: 'phc_abc', EXPO_PUBLIC_POSTHOG_HOST: undefined }),
    ).toEqual({ EXPO_PUBLIC_POSTHOG_KEY: 'phc_abc', EXPO_PUBLIC_POSTHOG_HOST: DEFAULT_HOST });
  });

  it('treats the .env.example shape `KEY=` as absent, not as an invalid value', () => {
    expect(parseMobileEnv({ EXPO_PUBLIC_POSTHOG_KEY: '' }).EXPO_PUBLIC_POSTHOG_KEY).toBeNull();
  });

  it('falls back to the US cloud host when none is configured', () => {
    expect(parseMobileEnv({}).EXPO_PUBLIC_POSTHOG_HOST).toBe(DEFAULT_HOST);
  });

  it('accepts an alternative ingestion host', () => {
    expect(
      parseMobileEnv({ EXPO_PUBLIC_POSTHOG_HOST: 'https://eu.i.posthog.com' })
        .EXPO_PUBLIC_POSTHOG_HOST,
    ).toBe('https://eu.i.posthog.com');
  });

  // A mobile build that boots is already shipped: refusing to run over a
  // malformed optional value would be a crash on a coach's phone, which is
  // strictly worse than the integration being off.
  it('degrades to the defaults rather than throwing on a malformed value', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(parseMobileEnv({ EXPO_PUBLIC_POSTHOG_HOST: 'not-a-url' })).toEqual({
      EXPO_PUBLIC_POSTHOG_KEY: null,
      EXPO_PUBLIC_POSTHOG_HOST: DEFAULT_HOST,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    // The variable name, never its value.
    expect(warn.mock.calls[0]?.[0]).toContain('EXPO_PUBLIC_POSTHOG_HOST');
    expect(warn.mock.calls[0]?.[0]).not.toContain('not-a-url');

    warn.mockRestore();
  });
});
