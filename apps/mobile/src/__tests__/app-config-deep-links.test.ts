import type { ConfigContext } from 'expo/config';

import appConfig from '../../app.config.ts';

// `phase-05-app-shell/deep-linking/01`'s acceptance criteria, as assertions.
// Its Verification section is a physical device tap, which cannot run here —
// what CAN run is the check that the three registrations survive a config
// evaluation, because the way this task regresses is not a wrong value but a
// missing one: `associatedDomains` and `intentFilters` are only read at
// `expo prebuild`, so dropping either is invisible until a link silently
// opens the browser on someone's phone weeks later.

const config = appConfig({ config: { name: 'coach-os', slug: 'coach-os' } } as ConfigContext);

const HOST = 'app.coachos.com';

describe('deep-link registration in app.config.ts', () => {
  it('registers the coachos:// scheme', () => {
    expect([config.scheme].flat()).toContain('coachos');
  });

  // Google Sign-In (`useGoogleSignIn.ts`) redirects to
  // `${applicationId}:/oauthredirect`; iOS registers the bundle id as a
  // scheme by itself, Android only registers what is listed here.
  it('registers the app id as a scheme so the Google Sign-In redirect can return', () => {
    expect([config.scheme].flat()).toContain(config.android?.package);
    expect(config.android?.package).toBe(config.ios?.bundleIdentifier);
  });

  it('claims the universal-link host in the iOS associated-domains entitlement', () => {
    expect(config.ios?.associatedDomains).toEqual([`applinks:${HOST}`]);
  });

  it('declares the same host as a verified Android App Link', () => {
    const filters = config.android?.intentFilters ?? [];
    const appLink = filters.find((filter) =>
      filter.data === undefined
        ? false
        : [filter.data].flat().some((entry) => entry?.host === HOST),
    );

    expect(appLink).toBeDefined();
    // Without `autoVerify` Android shows a chooser instead of opening the
    // app, which reads as "deep links don't work" and is the single most
    // likely way this entry degrades without disappearing.
    expect(appLink?.autoVerify).toBe(true);
    expect(appLink?.action).toBe('VIEW');
    expect(appLink?.category).toEqual(expect.arrayContaining(['BROWSABLE', 'DEFAULT']));
    expect([appLink?.data].flat()).toEqual([{ scheme: 'https', host: HOST, pathPrefix: '/' }]);
  });

  it('keeps both platforms pointed at one host', () => {
    const iosHost = config.ios?.associatedDomains?.[0]?.replace('applinks:', '');
    const androidHosts = (config.android?.intentFilters ?? []).flatMap((filter) =>
      [filter.data ?? []].flat().map((entry) => entry?.host),
    );

    expect(androidHosts).toContain(iosHost);
  });
});
