// Type-only, so nothing is required at module scope and every launch below
// still gets a genuinely fresh registry.
import type * as AuthStore from '../../auth/store.ts';
import type * as CoachStore from '../coach-store.ts';

// Rehydration is exercised directly rather than assumed from `persist`
// (`01-step-persistence` acceptance criterion 4): every `launch()` throws
// the module registry away and builds the store again from nothing but what
// the previous one left in storage, which is the closest a Jest process
// gets to a force-quit.

const mockRows = new Map<string, string>();

jest.mock('expo-sqlite', () => {
  const database = {
    execSync: jest.fn(),
    runSync: jest.fn((sql: string, params: unknown[] = []) => {
      if (sql.startsWith('INSERT OR REPLACE')) {
        mockRows.set(String(params[0]), String(params[1]));
      } else if (sql.startsWith('DELETE FROM onboarding_drafts WHERE key')) {
        mockRows.delete(String(params[0]));
      }
      return { changes: 1, lastInsertRowId: 0 };
    }),
    getFirstSync: jest.fn((_sql: string, params: unknown[] = []) => {
      const value = mockRows.get(String(params[0]));
      return value === undefined ? null : { value };
    }),
  };
  return { openDatabaseSync: jest.fn(() => database) };
});

type CoachStoreModule = typeof CoachStore;
type AuthStoreModule = typeof AuthStore;
type Launched = { coach: CoachStoreModule; auth: AuthStoreModule };

const USER_A = '0199a1f0-0000-7000-8000-00000000000a';
const USER_B = '0199a1f0-0000-7000-8000-00000000000b';
const DRAFT_KEY = 'onboarding-draft-coach';

/** A cold start: fresh module registry, same "disk". */
function launch(): Launched {
  let launched: Launched | null = null;
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const auth = require('../../auth/store.ts') as AuthStoreModule;
    const coach = require('../coach-store.ts') as CoachStoreModule;
    /* eslint-enable @typescript-eslint/no-require-imports */
    launched = { auth, coach };
  });
  if (!launched) throw new Error('the isolated module registry produced nothing');
  return launched;
}

function signIn({ auth }: Launched, userId: string): void {
  auth.useAuthStore.getState().setAuthenticated({ userId, role: 'coach', isOnboarded: false });
}

function draftOf({ coach }: Launched) {
  return coach.useCoachOnboardingStore.getState();
}

beforeEach(() => {
  mockRows.clear();
});

describe('the coach onboarding draft', () => {
  it('resumes at the same step with the same values after an app kill', () => {
    const first = launch();
    signIn(first, USER_A);
    draftOf(first).updateField('businessName', 'Iron Path');
    draftOf(first).updateField('specialties', ['strength', 'rehab']);
    draftOf(first).setStep(2);

    const second = launch();
    signIn(second, USER_A);

    expect(draftOf(second).currentStep).toBe(2);
    expect(draftOf(second).fields.businessName).toBe('Iron Path');
    expect(draftOf(second).fields.specialties).toEqual(['strength', 'rehab']);
  });

  it('clears the persisted draft on reset, so a completed flow leaves nothing behind', () => {
    const first = launch();
    signIn(first, USER_A);
    draftOf(first).updateField('businessName', 'Iron Path');
    draftOf(first).setStep(3);
    expect(mockRows.has(DRAFT_KEY)).toBe(true);

    draftOf(first).reset();

    expect(draftOf(first).currentStep).toBe(0);
    expect(draftOf(first).fields.businessName).toBe('');
    expect(mockRows.has(DRAFT_KEY)).toBe(false);

    const second = launch();
    signIn(second, USER_A);
    expect(draftOf(second).currentStep).toBe(0);
    expect(draftOf(second).fields.businessName).toBe('');
  });

  it('clears the draft when the user signs out', () => {
    const app = launch();
    signIn(app, USER_A);
    draftOf(app).updateField('businessName', 'Iron Path');
    draftOf(app).setStep(2);

    app.auth.useAuthStore.getState().setSignedOut();

    expect(draftOf(app).currentStep).toBe(0);
    expect(draftOf(app).fields.businessName).toBe('');
    expect(mockRows.has(DRAFT_KEY)).toBe(false);
  });

  it("never rehydrates one user's draft into another user's session", () => {
    // The task's stated risk: a shared or reused device where user A's
    // in-progress draft would otherwise reappear inside user B's flow.
    const first = launch();
    signIn(first, USER_A);
    draftOf(first).updateField('businessName', 'Iron Path');
    draftOf(first).setStep(2);

    const second = launch();
    signIn(second, USER_B);

    expect(draftOf(second).currentStep).toBe(0);
    expect(draftOf(second).fields.businessName).toBe('');
    expect(mockRows.has(DRAFT_KEY)).toBe(false);
  });

  it('does not discard the draft while auth is still resolving', () => {
    // Cold start order matters: the store rehydrates before `bootstrap()`
    // knows who is signed in, so "no user yet" must not be read as "a
    // different user".
    const first = launch();
    signIn(first, USER_A);
    draftOf(first).setStep(2);

    const second = launch();

    expect(second.auth.useAuthStore.getState().status).toBe('loading');
    expect(draftOf(second).currentStep).toBe(2);
  });

  it('stamps a write with the signed-in user rather than trusting the stored row', () => {
    const app = launch();
    signIn(app, USER_A);
    draftOf(app).updateField('businessName', 'Iron Path');

    expect(draftOf(app).draftUserId).toBe(USER_A);
  });

  it('starts clean rather than throwing when the stored draft is unreadable', () => {
    mockRows.set(DRAFT_KEY, 'not json');

    const app = launch();

    expect(draftOf(app).currentStep).toBe(0);
    expect(draftOf(app).fields.businessName).toBe('');
  });
});
