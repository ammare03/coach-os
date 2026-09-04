import * as haptics from './index.ts';

// The literals are `expo-haptics`' own declared enum values
// (`ImpactFeedbackStyle.Light === 'light'`, `NotificationFeedbackType`
// `.Success === 'success'` / `.Warning === 'warning'`). Asserting the
// literal rather than the mock's own constant is the point: it fails if a
// function is ever repointed at a different waveform, which is exactly the
// drift `CLAUDE.md` §7.5 forbids.
//
// The `mock` prefix is required — `babel-plugin-jest-hoist` hoists the factory
// above these declarations and rejects any other out-of-scope reference.
const mockImpactAsync = jest.fn((_style?: string): Promise<void> => Promise.resolve());
const mockNotificationAsync = jest.fn((_type?: string): Promise<void> => Promise.resolve());

jest.mock('expo-haptics', () => ({
  impactAsync: (style?: string) => mockImpactAsync(style),
  notificationAsync: (type?: string) => mockNotificationAsync(type),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

beforeEach(() => {
  mockImpactAsync.mockClear();
  mockNotificationAsync.mockClear();
  mockImpactAsync.mockImplementation(() => Promise.resolve());
  mockNotificationAsync.mockImplementation(() => Promise.resolve());
});

describe('the haptics policy', () => {
  it('exports exactly the three sanctioned functions and nothing else', () => {
    // The restriction IS the task (`screen-states/04`). A fourth export —
    // above all a generic `triggerHaptic(type)` — is how the three-haptic
    // policy quietly becomes a thirty-haptic one.
    expect(Object.keys(haptics).sort()).toEqual([
      'hapticSessionComplete',
      'hapticSetLogged',
      'hapticValidationFailure',
    ]);
  });

  it('exposes no generic haptic-triggering function', () => {
    const surface = Object.keys(haptics);

    expect(surface).not.toContain('triggerHaptic');
    expect(surface).not.toContain('impactAsync');
    expect(surface).not.toContain('notificationAsync');
    expect(surface).not.toContain('selectionAsync');
  });
});

describe('hapticSetLogged', () => {
  it('is a Light impact', () => {
    haptics.hapticSetLogged();

    expect(mockImpactAsync).toHaveBeenCalledTimes(1);
    expect(mockImpactAsync).toHaveBeenCalledWith('light');
    expect(mockNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('hapticSessionComplete', () => {
  it('is a Success notification', () => {
    haptics.hapticSessionComplete();

    expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mockNotificationAsync).toHaveBeenCalledWith('success');
    expect(mockImpactAsync).not.toHaveBeenCalled();
  });
});

describe('hapticValidationFailure', () => {
  it('is a Warning notification, never an Error one', () => {
    haptics.hapticValidationFailure();

    expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mockNotificationAsync).toHaveBeenCalledWith('warning');
    expect(mockNotificationAsync).not.toHaveBeenCalledWith('error');
  });
});

describe('a device with no taptic engine', () => {
  it('swallows the rejection rather than leaving it unhandled', async () => {
    // A simulator, a cheap Android, and web all reject here. An unhandled
    // rejection per logged set is a Sentry entry per set.
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);

    mockImpactAsync.mockImplementation(() => Promise.reject(new Error('Haptics unavailable')));
    mockNotificationAsync.mockImplementation(() =>
      Promise.reject(new Error('Haptics unavailable')),
    );

    expect(() => {
      haptics.hapticSetLogged();
      haptics.hapticSessionComplete();
      haptics.hapticValidationFailure();
    }).not.toThrow();

    // Two turns of the microtask queue: one for the rejection, one for the
    // `.catch` that absorbs it.
    await Promise.resolve();
    await Promise.resolve();

    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('returns nothing, so no call site can await or branch on the result', () => {
    expect(haptics.hapticSetLogged()).toBeUndefined();
    expect(haptics.hapticSessionComplete()).toBeUndefined();
    expect(haptics.hapticValidationFailure()).toBeUndefined();
  });
});
