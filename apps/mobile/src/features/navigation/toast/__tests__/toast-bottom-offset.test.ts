import { TOAST_BOTTOM_OFFSET } from '@coachos/ui';

import { clientTabBarInset } from '../../client/client-dock-geometry.ts';
import { coachTabBarInset } from '../../coach/coach-dock-metrics.ts';
import { resolveToastBottomOffset } from '../toast-bottom-offset.ts';

// UNFORGET S46. `TOAST_BOTTOM_OFFSET` is `DESIGN.md` §9's ACTION BAR position,
// and §9 states that position only as "above the dock". Two of the app's
// eleven layouts draw a dock; the other nine do not, so on those the constant
// is 76px of borrowed meaning.
//
// The docked cases below are the regression guard, not decoration: 102 is
// correct where a dock exists and must stay correct there.

/** A device with no bottom inset — the one §9's own numbers are written for. */
const NO_INSET = 0;
/** An iPhone home indicator. */
const HOME_INDICATOR = 34;
/** An Android three-button navigation bar — materially larger. */
const ANDROID_NAV_BAR = 48;

/**
 * Every route group that renders no dock, as `useSegments()` reports it.
 * Enumerated rather than sampled: the dock is structural — it belongs to the
 * `(tabs)` navigator and nothing else (`(coach)/_layout.tsx`) — so a group
 * appearing here is a claim about the layout tree, and the claim is what a
 * later phase adding a group would have to come and update.
 */
const DOCKLESS_SEGMENTS: readonly (readonly string[])[] = [
  // The router before it has resolved anything.
  [],
  // Root-level routes, outside every group.
  ['index'],
  ['+not-found'],
  ['delete-account'],
  ['medical-disclaimer'],
  ['pending-deletion'],
  ['your-data'],
  // (auth)
  ['(auth)', 'welcome'],
  ['(auth)', 'sign-in'],
  ['(auth)', 'invite', '[code]'],
  // Onboarding
  ['(coach-onboarding)', 'index'],
  ['(client-onboarding)', 'index'],
  // Coach group, outside (tabs) — settings is S46's own case.
  ['(coach)', 'settings', 'index'],
  ['(coach)', 'client', '[id]', 'training'],
  ['(coach)', 'program', '[id]', 'index'],
  ['(coach)', 'invite-client'],
  // Coach focus modes.
  ['(coach)', 'session', '[id]'],
  ['(coach)', 'video', '[id]'],
  ['(coach)', 'live', '[sessionId]'],
  // Client group, outside (tabs).
  ['(client)', 'settings', 'index'],
  ['(client)', 'settings', 'sharing'],
  ['(client)', 'checkin', '[id]'],
  // Client focus modes and modals.
  ['(client)', 'workout', '[sessionId]'],
  ['(client)', 'live', '[sessionId]'],
  ['(client)', 'log-food'],
  ['(client)', 'scan'],
  ['(client)', 'record-form-check'],
];

const COACH_TABS = ['(coach)', '(tabs)', 'clients'] as const;
const CLIENT_TABS = ['(client)', '(tabs)', 'index'] as const;

describe('resolveToastBottomOffset', () => {
  describe('a route with a dock', () => {
    it('keeps the toast one content gap above the coach dock', () => {
      expect(resolveToastBottomOffset(COACH_TABS, NO_INSET)).toBe(coachTabBarInset(NO_INSET));
    });

    it('keeps the toast one content gap above the client dock', () => {
      expect(resolveToastBottomOffset(CLIENT_TABS, NO_INSET)).toBe(clientTabBarInset(NO_INSET));
    });

    // The regression guard. §9's 102 is measured on a device with no bottom
    // inset, and on that device nothing about a docked route may move.
    it('is exactly the shipped 102 on a device with no bottom inset', () => {
      expect(resolveToastBottomOffset(COACH_TABS, NO_INSET)).toBe(TOAST_BOTTOM_OFFSET);
      expect(resolveToastBottomOffset(CLIENT_TABS, NO_INSET)).toBe(TOAST_BOTTOM_OFFSET);
    });

    // The coach dock subtracts the home indicator's own height before
    // reconciling, so on an iPhone it does not move and neither may the toast.
    it('does not move the coach toast on a home-indicator device', () => {
      expect(resolveToastBottomOffset(COACH_TABS, HOME_INDICATOR)).toBe(TOAST_BOTTOM_OFFSET);
    });

    // The client dock does move (`clientDockBottom` is a plain `max`), and a
    // static 102 left only 4px of the designed 12px gap.
    it('tracks the client dock when the safe area lifts it', () => {
      expect(resolveToastBottomOffset(CLIENT_TABS, HOME_INDICATOR)).toBe(
        clientTabBarInset(HOME_INDICATOR),
      );
      expect(resolveToastBottomOffset(CLIENT_TABS, HOME_INDICATOR)).toBeGreaterThan(
        TOAST_BOTTOM_OFFSET,
      );
    });
  });

  describe('a route with no dock', () => {
    it.each(DOCKLESS_SEGMENTS)('sits on the bottom floor on %p', (...segments) => {
      const route = segments.flat();
      expect(resolveToastBottomOffset(route, NO_INSET)).toBe(26);
    });

    it('is not the action bar position', () => {
      expect(resolveToastBottomOffset(['(client)', 'settings', 'sharing'], NO_INSET)).not.toBe(
        TOAST_BOTTOM_OFFSET,
      );
    });

    it('clears a home indicator rather than sitting under it', () => {
      expect(resolveToastBottomOffset(['(coach)', 'settings', 'index'], HOME_INDICATOR)).toBe(
        HOME_INDICATOR,
      );
    });

    it('clears an Android navigation bar', () => {
      expect(resolveToastBottomOffset(['(coach)', 'settings', 'index'], ANDROID_NAV_BAR)).toBe(
        ANDROID_NAV_BAR,
      );
    });
  });

  // `(tabs)` is the whole test for a dock, and it is never the first segment —
  // a bare `['(tabs)']` cannot be routed to. Asserted so that a future group
  // named for a tab screen cannot quietly claim a dock it does not draw.
  it('reads the dock off the (tabs) segment, not the group', () => {
    expect(resolveToastBottomOffset(['(coach)', 'tabs', 'clients'], NO_INSET)).toBe(26);
    expect(resolveToastBottomOffset(['(coach)', '(tabs)'], NO_INSET)).toBe(
      coachTabBarInset(NO_INSET),
    );
  });
});
