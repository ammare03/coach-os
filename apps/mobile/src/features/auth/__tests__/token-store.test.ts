import * as SecureStore from 'expo-secure-store';

import { clearTokens, getDeviceId, getTokens, setDeviceId, setTokens } from '../token-store.ts';

// In-memory fake standing in for the Keychain / EncryptedSharedPreferences
// backing — real enough to prove ordering and partial-write recovery
// without touching native code jest-expo doesn't mock for this module.
// Named `mockStore` (not `store`) because jest's module-factory scoping
// only allows referencing variables prefixed with `mock`. `jest.mock` calls
// are hoisted above these imports by babel-jest, so declaration order here
// doesn't affect what the imports above actually receive.
const mockStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockStore.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockStore.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockStore.delete(key);
    return Promise.resolve();
  }),
}));

const session = {
  accessToken: 'access-123',
  refreshToken: 'refresh-456',
  accessExpiresAt: '2026-08-28T12:00:00.000Z',
};

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

describe('token-store', () => {
  it('round-trips a written session', async () => {
    await setTokens(session);

    expect(await getTokens()).toEqual(session);
  });

  it('writes only the closed key set, with the coachos.auth. prefix', async () => {
    await setTokens(session);
    await setDeviceId('device-1');

    const keys = [...mockStore.keys()].filter((key) => key.startsWith('coachos.auth.'));
    expect(keys.sort()).toEqual(
      [
        'coachos.auth.access_token',
        'coachos.auth.refresh_token',
        'coachos.auth.access_expires_at',
        'coachos.auth.device_id',
      ].sort(),
    );
  });

  it('stores no email or name alongside the tokens', async () => {
    await setTokens(session);

    for (const value of mockStore.values()) {
      expect(value).not.toMatch(/@/);
    }
  });

  it('writes every key with WHEN_UNLOCKED_THIS_DEVICE_ONLY accessibility', async () => {
    await setTokens(session);

    const setItemAsync = SecureStore.setItemAsync as jest.Mock;
    for (const call of setItemAsync.mock.calls) {
      expect(call[2]).toMatchObject({ keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' });
    }
  });

  it('clear removes the access token, refresh token, and expiry, but keeps the device id', async () => {
    await setTokens(session);
    await setDeviceId('device-1');

    await clearTokens();

    expect(await getTokens()).toBeNull();
    expect(await getDeviceId()).toBe('device-1');
  });

  it('returns null unless both the access and refresh tokens are present', async () => {
    await setTokens(session);
    await (SecureStore.deleteItemAsync as jest.Mock)('coachos.auth.refresh_token');

    expect(await getTokens()).toBeNull();
  });

  it('leaves no readable session when a write fails partway', async () => {
    const setItemAsync = SecureStore.setItemAsync as jest.Mock;
    setItemAsync.mockImplementationOnce((key: string, value: string) => {
      mockStore.set(key, value);
      return Promise.resolve();
    });
    setItemAsync.mockImplementationOnce(() => Promise.reject(new Error('keystore write failed')));

    await expect(setTokens(session)).rejects.toThrow('keystore write failed');
    expect(await getTokens()).toBeNull();
  });

  it('returns null rather than throwing when a read fails', async () => {
    const getItemAsync = SecureStore.getItemAsync as jest.Mock;
    getItemAsync.mockRejectedValueOnce(new Error('keystore reset'));

    await expect(getTokens()).resolves.toBeNull();
  });
});
