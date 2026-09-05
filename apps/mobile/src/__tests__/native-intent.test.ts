import { redirectSystemPath } from '../app/+native-intent.ts';
import { useAuthStore } from '../features/auth/store.ts';

// `deep-linking/02`. The route file itself, wired to the real store — the
// resolution rules are covered under `features/navigation/deep-links/`; what
// is asserted here is the contract expo-router relies on: a string always
// comes back, and an unrecognised one comes back unchanged.

beforeEach(() => {
  useAuthStore.setState({ status: 'unauthenticated', userId: null, role: null });
});

describe('redirectSystemPath', () => {
  it('rewrites a known link to its route', () => {
    expect(redirectSystemPath({ path: 'coachos://reset-password/tok', initial: true })).toBe(
      '/(auth)/reset-password/tok',
    );
  });

  it('hands an unrecognised CoachOS path back untouched', () => {
    const path = 'coachos://nope/1';
    expect(redirectSystemPath({ path, initial: false })).toBe(path);
  });

  it("hands another app's link back untouched", () => {
    const path = 'https://example.com/invite/ABC';
    expect(redirectSystemPath({ path, initial: true })).toBe(path);
  });

  it('never throws on a malformed URL', () => {
    for (const path of ['', '%', 'coachos://%', '::::']) {
      expect(() => redirectSystemPath({ path, initial: true })).not.toThrow();
      expect(typeof redirectSystemPath({ path, initial: true })).toBe('string');
    }
  });
});
