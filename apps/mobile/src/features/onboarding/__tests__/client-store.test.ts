// Type-only, so nothing is required at module scope and every launch below
// still gets a genuinely fresh registry.
import type * as AuthStore from '../../auth/store.ts';
import type * as ClientStore from '../client-store.ts';
import type * as CoachStore from '../coach-store.ts';

// The client flow's half of `01-step-persistence`. Same mechanism as
// `coach-store.test.ts`, asserted separately because the two stores are two
// storage keys and a draft leaking between them would be just as wrong as
// one leaking between users.

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

type ClientStoreModule = typeof ClientStore;
type CoachStoreModule = typeof CoachStore;
type AuthStoreModule = typeof AuthStore;
type Launched = { client: ClientStoreModule; coach: CoachStoreModule; auth: AuthStoreModule };

const USER_A = '0199a1f0-0000-7000-8000-00000000000a';
const USER_B = '0199a1f0-0000-7000-8000-00000000000b';
const DRAFT_KEY = 'onboarding-draft-client';

function launch(): Launched {
  let launched: Launched | null = null;
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const auth = require('../../auth/store.ts') as AuthStoreModule;
    const client = require('../client-store.ts') as ClientStoreModule;
    const coach = require('../coach-store.ts') as CoachStoreModule;
    /* eslint-enable @typescript-eslint/no-require-imports */
    launched = { auth, client, coach };
  });
  if (!launched) throw new Error('the isolated module registry produced nothing');
  return launched;
}

function signIn({ auth }: Launched, userId: string): void {
  auth.useAuthStore.getState().setAuthenticated({ userId, role: 'client', isOnboarded: false });
}

function draftOf({ client }: Launched) {
  return client.useClientOnboardingStore.getState();
}

beforeEach(() => {
  mockRows.clear();
});

describe('the client onboarding draft', () => {
  it('resumes at the same step with the same values after an app kill', () => {
    const first = launch();
    signIn(first, USER_A);
    draftOf(first).updateField('goal', 'build-muscle');
    draftOf(first).updateField('heightCm', 178);
    draftOf(first).updateField('equipmentAccess', ['barbell', 'dumbbells']);
    draftOf(first).setStep(3);

    const second = launch();
    signIn(second, USER_A);

    expect(draftOf(second).currentStep).toBe(3);
    expect(draftOf(second).fields.goal).toBe('build-muscle');
    expect(draftOf(second).fields.heightCm).toBe(178);
    expect(draftOf(second).fields.equipmentAccess).toEqual(['barbell', 'dumbbells']);
  });

  it('clears the persisted draft on reset', () => {
    const app = launch();
    signIn(app, USER_A);
    draftOf(app).updateField('goal', 'build-muscle');
    draftOf(app).setStep(2);

    draftOf(app).reset();

    expect(draftOf(app).currentStep).toBe(0);
    expect(draftOf(app).fields.goal).toBe('');
    expect(draftOf(app).fields.heightCm).toBeNull();
    expect(mockRows.has(DRAFT_KEY)).toBe(false);
  });

  it("never rehydrates one user's draft into another user's session", () => {
    const first = launch();
    signIn(first, USER_A);
    draftOf(first).updateField('goal', 'build-muscle');
    draftOf(first).setStep(2);

    const second = launch();
    signIn(second, USER_B);

    expect(draftOf(second).currentStep).toBe(0);
    expect(draftOf(second).fields.goal).toBe('');
    expect(mockRows.has(DRAFT_KEY)).toBe(false);
  });

  it('clears the draft when the user signs out', () => {
    const app = launch();
    signIn(app, USER_A);
    draftOf(app).updateField('goal', 'build-muscle');

    app.auth.useAuthStore.getState().setSignedOut();

    expect(draftOf(app).fields.goal).toBe('');
    expect(mockRows.has(DRAFT_KEY)).toBe(false);
  });

  it('keeps the two flows in separate rows', () => {
    const app = launch();
    signIn(app, USER_A);
    draftOf(app).updateField('goal', 'build-muscle');
    app.coach.useCoachOnboardingStore.getState().updateField('businessName', 'Iron Path');

    expect(mockRows.has(DRAFT_KEY)).toBe(true);
    expect(mockRows.has('onboarding-draft-coach')).toBe(true);
    expect(draftOf(app).fields.goal).toBe('build-muscle');
    expect(app.coach.useCoachOnboardingStore.getState().fields.businessName).toBe('Iron Path');
  });
});
