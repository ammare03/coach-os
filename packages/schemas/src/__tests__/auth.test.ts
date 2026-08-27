// One valid case, one invalid case per shape (CLAUDE.md §18.1).
import { authSession, refreshOutput } from '../auth-session.ts';
import { password, refreshInput, signInInput, signUpInput } from '../auth.ts';

describe('password', () => {
  it('accepts an 8+ character password', () => {
    expect(password.safeParse('a1b2c3d4').success).toBe(true);
  });

  it('rejects a password shorter than 8 characters', () => {
    expect(password.safeParse('short').success).toBe(false);
  });
});

describe('signUpInput', () => {
  const valid = {
    email: 'coach@example.com',
    password: 'a-real-password',
    name: 'Coach Example',
    timezone: 'Asia/Kolkata',
    platform: 'ios' as const,
  };

  it('accepts a well-formed sign-up', () => {
    expect(signUpInput.safeParse(valid).success).toBe(true);
  });

  it('lowercases and trims the email, matching the citext column', () => {
    const result = signUpInput.parse({ ...valid, email: '  Coach@Example.com  ' });
    expect(result.email).toBe('coach@example.com');
  });

  it('rejects an unknown key — role is not a field a caller can send', () => {
    expect(signUpInput.safeParse({ ...valid, role: 'client' }).success).toBe(false);
  });

  it('rejects a malformed timezone', () => {
    expect(signUpInput.safeParse({ ...valid, timezone: 'Not/AZone' }).success).toBe(false);
  });
});

describe('signInInput', () => {
  const valid = { email: 'coach@example.com', password: 'anything', platform: 'android' as const };

  it('accepts a well-formed sign-in', () => {
    expect(signInInput.safeParse(valid).success).toBe(true);
  });

  it('rejects an empty password', () => {
    expect(signInInput.safeParse({ ...valid, password: '' }).success).toBe(false);
  });

  it('accepts an optional deviceId for a returning device', () => {
    const result = signInInput.safeParse({
      ...valid,
      deviceId: '01926b8e-0000-7000-8000-000000000000',
    });
    expect(result.success).toBe(true);
  });
});

describe('authSession', () => {
  const valid = {
    accessToken: 'a.b.c',
    refreshToken: 'opaque-token',
    expiresAt: '2026-08-27T00:00:00.000Z',
    deviceId: '01926b8e-0000-7000-8000-000000000000',
    user: {
      id: '01926b8e-0000-7000-8000-000000000001',
      role: 'coach' as const,
      name: 'Coach Example',
      timezone: 'Asia/Kolkata',
      onboardingCompletedAt: null,
    },
  };

  it('accepts a well-formed session', () => {
    expect(authSession.safeParse(valid).success).toBe(true);
  });

  it('rejects a missing accessToken', () => {
    const rest: Record<string, unknown> = { ...valid };
    delete rest.accessToken;
    expect(authSession.safeParse(rest).success).toBe(false);
  });
});

describe('refreshInput', () => {
  it('accepts a non-empty refresh token', () => {
    expect(refreshInput.safeParse({ refreshToken: 'opaque-token' }).success).toBe(true);
  });

  it('rejects an empty refresh token', () => {
    expect(refreshInput.safeParse({ refreshToken: '' }).success).toBe(false);
  });
});

describe('refreshOutput', () => {
  it('accepts a well-formed rotation response', () => {
    const result = refreshOutput.safeParse({
      accessToken: 'a.b.c',
      refreshToken: 'opaque-token',
      expiresAt: '2026-08-27T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing refreshToken', () => {
    const rest: Record<string, unknown> = {
      accessToken: 'a.b.c',
      expiresAt: '2026-08-27T00:00:00.000Z',
    };
    expect(refreshOutput.safeParse(rest).success).toBe(false);
  });
});
