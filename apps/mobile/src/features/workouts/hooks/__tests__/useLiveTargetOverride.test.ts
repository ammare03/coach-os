import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as outboxEnqueue from '../../../../lib/outbox/enqueue.ts';
import { buildBlock } from '../../../../lib/prefetch/__fixtures__/upcoming.ts';
import {
  applyLiveTargetOverride,
  isLiveOverridden,
  mergeLiveOverride,
  openLiveOverrideSession,
  resetLiveTargetOverridesForTests,
  selectLiveOverride,
  useLiveTargetOverrideStore,
} from '../useLiveTargetOverride.ts';

// `phase-09-workout-logger/session-modifications/04` — the entry point
// `phase-19-live-sessions` will call, proved to work with no transport in
// front of it, because there is no transport in front of it yet.
//
// Five acceptance criteria, and four of them are about what this does NOT
// do: no transport dependency, no authorization, no outbox entry, no reach
// into the program itself.

const store = () => useLiveTargetOverrideStore.getState();

const SESSION = 'session-local-1';
const EXERCISE = 'exercise-1';

afterEach(() => {
  resetLiveTargetOverridesForTests();
});

describe('applyLiveTargetOverride — the one entry point', () => {
  it('is callable with no session, no React tree, and no transport in front of it', () => {
    // Nothing is mounted, nothing is connected, nothing was awaited. If this
    // ever needs setup, P19 has been handed a harder contract than it was
    // promised.
    openLiveOverrideSession(SESSION);
    applyLiveTargetOverride(EXERCISE, { targetSets: 3 });

    expect(selectLiveOverride(store(), EXERCISE, SESSION)).toEqual({ targetSets: 3 });
  });

  it('updates local state synchronously, within the same tick as the call', () => {
    openLiveOverrideSession(SESSION);

    applyLiveTargetOverride(EXERCISE, { targetRpe: 7 });
    // Deliberately no await, no flush, no timer advance — `set-entry/01`'s
    // <100ms budget is met by there being no asynchrony at all.
    const immediately = selectLiveOverride(store(), EXERCISE, SESSION);

    expect(immediately).toEqual({ targetRpe: 7 });
  });

  it('accumulates successive adjustments rather than replacing them', () => {
    openLiveOverrideSession(SESSION);

    applyLiveTargetOverride(EXERCISE, { targetSets: 3 });
    applyLiveTargetOverride(EXERCISE, { targetRpe: 7 });

    expect(selectLiveOverride(store(), EXERCISE, SESSION)).toEqual({
      targetSets: 3,
      targetRpe: 7,
    });
  });

  it('ignores an empty adjustment rather than marking the target changed', () => {
    openLiveOverrideSession(SESSION);

    applyLiveTargetOverride(EXERCISE, {});

    expect(selectLiveOverride(store(), EXERCISE, SESSION)).toBeNull();
  });

  it('keeps one exercise’s adjustment off every other exercise', () => {
    openLiveOverrideSession(SESSION);

    applyLiveTargetOverride(EXERCISE, { targetSets: 3 });

    expect(selectLiveOverride(store(), 'exercise-2', SESSION)).toBeNull();
  });
});

describe('session scope', () => {
  it('does not carry an adjustment into a different session', () => {
    openLiveOverrideSession(SESSION);
    applyLiveTargetOverride(EXERCISE, { targetSets: 3 });

    openLiveOverrideSession('session-local-2');

    expect(selectLiveOverride(store(), EXERCISE, 'session-local-2')).toBeNull();
  });

  it('never reports an adjustment to a reader asking about another session', () => {
    openLiveOverrideSession(SESSION);
    applyLiveTargetOverride(EXERCISE, { targetSets: 3 });

    // The guard is in the read, not only in the wipe — so a stale override
    // cannot render for even one frame while the effect that re-scopes the
    // store is still pending.
    expect(selectLiveOverride(store(), EXERCISE, 'session-local-2')).toBeNull();
  });

  it('is idempotent for the session already open', () => {
    openLiveOverrideSession(SESSION);
    applyLiveTargetOverride(EXERCISE, { targetSets: 3 });

    openLiveOverrideSession(SESSION);

    expect(selectLiveOverride(store(), EXERCISE, SESSION)).toEqual({ targetSets: 3 });
  });
});

describe('mergeLiveOverride — additive, never a replacement target', () => {
  it('changes only the fields the coach named', () => {
    const target = buildBlock({
      targetSets: 4,
      targetRepsMin: 6,
      targetRepsMax: 8,
      targetRpe: 8.5,
    });

    const merged = mergeLiveOverride(target, { targetSets: 3, targetRpe: 7 });

    expect(merged).toMatchObject({
      targetSets: 3,
      targetRpe: 7,
      // Untouched — the override is a layer on the prescription, not a new one.
      targetRepsMin: 6,
      targetRepsMax: 8,
      targetWeightKg: 62.5,
      targetRestSeconds: 120,
      tempo: '3010',
    });
  });

  it('leaves the coach-authored target object itself unmodified', () => {
    const target = buildBlock({ targetSets: 4 });

    mergeLiveOverride(target, { targetSets: 3 });

    expect(target.targetSets).toBe(4);
  });

  it('returns the prescription unchanged when there is no adjustment', () => {
    const target = buildBlock();

    expect(mergeLiveOverride(target, null)).toBe(target);
  });

  it('has nothing to override when the block carries no prescription', () => {
    // An ad-hoc block has no `program_exercises` row, so there is no base to
    // merge onto. Documented contract, not an oversight — see the module.
    expect(mergeLiveOverride(null, { targetSets: 3 })).toBeNull();
    expect(isLiveOverridden(null, { targetSets: 3 })).toBe(false);
  });

  it('reports an overridden target as overridden', () => {
    expect(isLiveOverridden(buildBlock(), { targetSets: 3 })).toBe(true);
    expect(isLiveOverridden(buildBlock(), null)).toBe(false);
  });
});

describe('what this deliberately does not do', () => {
  it('writes nothing to the offline outbox', () => {
    // `enqueueMutation` is the only door into the outbox — the repo's own
    // `outbox/no-direct-outbox-write` lint rule is what makes that true, so
    // "it was never called" is "nothing was queued".
    const enqueue = jest.spyOn(outboxEnqueue, 'enqueueMutation');
    openLiveOverrideSession(SESSION);

    applyLiveTargetOverride(EXERCISE, { targetSets: 3, targetRpe: 7 });

    // A live adjustment has no server-bound counterpart from this task's
    // scope: it only exists while the client is connected to their coach,
    // and it never touches `program_exercises`.
    expect(enqueue).not.toHaveBeenCalled();
    enqueue.mockRestore();
  });

  it('imports no transport, no API client, and no outbox', () => {
    const source = readFileSync(join(__dirname, '..', 'useLiveTargetOverride.ts'), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);

    // The whole value of this task is the smallest transport-agnostic
    // surface. A socket, a tRPC client, or an outbox call appearing here is
    // the regression the task doc names by name.
    expect(imports).toEqual(
      expect.not.arrayContaining([
        expect.stringMatching(/trpc|websocket|socket|livekit|outbox|api\/src/i),
      ]),
    );
  });
});
