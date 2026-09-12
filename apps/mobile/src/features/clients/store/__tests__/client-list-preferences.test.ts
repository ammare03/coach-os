import {
  DEFAULT_CLIENT_SORT,
  resetClientListPreferencesForTests,
  useClientListPreferences,
} from '../client-list-preferences.ts';
import {
  clientListPreferenceStorage,
  resetPreferenceStorageForTests,
} from '../preferences-storage.ts';

// `coach-dashboard/02`'s last acceptance criterion — "the coach's last-used
// sort/filter selection persists across app restarts". A restart is
// simulated the only way a unit test can: throw the in-memory state away
// and rehydrate from what was actually written to storage.

const STORAGE_KEY = useClientListPreferences.persist.getOptions().name ?? '';

function state() {
  return useClientListPreferences.getState();
}

beforeEach(() => {
  resetClientListPreferencesForTests();
  clientListPreferenceStorage.removeItem(STORAGE_KEY);
});

afterAll(() => {
  resetPreferenceStorageForTests();
});

describe('useClientListPreferences', () => {
  it('starts on attention-needed with nothing filtered', () => {
    expect(state().sort).toBe(DEFAULT_CLIENT_SORT);
    expect(state().statuses).toEqual([]);
    expect(state().goals).toEqual([]);
  });

  it('toggles a chip on and back off', () => {
    state().toggleStatus('invited');
    expect(state().statuses).toEqual(['invited']);

    state().toggleStatus('invited');
    expect(state().statuses).toEqual([]);
  });

  it('stores a selection in the vocabulary’s order, not in tap order', () => {
    state().toggleGoal('other');
    state().toggleGoal('fat_loss');

    expect(state().goals).toEqual(['fat_loss', 'other']);
  });

  it('clears both facets without touching the sort', () => {
    state().setSort('name');
    state().toggleStatus('active');
    state().toggleGoal('health');

    state().clearFilters();

    expect(state().statuses).toEqual([]);
    expect(state().goals).toEqual([]);
    expect(state().sort).toBe('name');
  });

  it('survives a restart', async () => {
    state().setSort('last-active');
    state().toggleStatus('invited');
    state().toggleGoal('performance');

    // What a real restart would find on disk. Captured first, because the
    // reset below is a test artifact that writes through the same persist
    // subscriber a real restart would never run.
    const onDisk = await clientListPreferenceStorage.getItem(STORAGE_KEY);
    expect(onDisk).toContain('last-active');

    // The restart: nothing in memory, everything from the row on disk.
    resetClientListPreferencesForTests();
    clientListPreferenceStorage.setItem(STORAGE_KEY, onDisk ?? '');
    await useClientListPreferences.persist.rehydrate();

    expect(state().sort).toBe('last-active');
    expect(state().statuses).toEqual(['invited']);
    expect(state().goals).toEqual(['performance']);
  });

  it('falls back to the default rather than trusting an unreadable row', async () => {
    clientListPreferenceStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { sort: 'by-vibes', statuses: 'all', goals: ['not_a_goal'] } }),
    );

    await useClientListPreferences.persist.rehydrate();

    expect(state().sort).toBe(DEFAULT_CLIENT_SORT);
    expect(state().statuses).toEqual([]);
    expect(state().goals).toEqual([]);
  });
});
