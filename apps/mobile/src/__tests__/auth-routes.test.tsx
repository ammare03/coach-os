import { render } from '@testing-library/react-native';

import AuthLayout from '../app/(auth)/_layout.tsx';
import ForgotPasswordRoute from '../app/(auth)/forgot-password.tsx';
import InviteRoute from '../app/(auth)/invite/[code].tsx';
import SignInRoute from '../app/(auth)/sign-in.tsx';
import SignUpRoute from '../app/(auth)/sign-up.tsx';
import WelcomeRoute from '../app/(auth)/welcome.tsx';
import { useAuthStore } from '../features/auth/store.ts';

// The closest rigorous stand-in for `router-skeleton/02`'s own verification
// ("navigate the full (auth) group on a device"), which needs hardware this
// task did not have. Every screen is replaced by a spy, so what is under
// test here is exactly the thing `CLAUDE.md` §9.2 cares about: that each
// route file composes the right feature-slice screen and does nothing else.
//
// Everything these files are allowed to contain is asserted below —
// composition, one navigation callback, and `invite/[code]`'s param
// extraction. There is nothing else in them to test, which is the point.

const mockStackScreenNames: string[] = [];
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => {
  const react = jest.requireActual('react');
  const Stack = Object.assign(
    ({ children }: { children: unknown }) => {
      react.Children.forEach(children, (child: unknown) => {
        const name = (child as { props?: { name?: unknown } } | null | undefined)?.props?.name;
        if (typeof name === 'string') {
          mockStackScreenNames.push(name);
        }
      });
      return null;
    },
    { Screen: () => null },
  );
  return {
    Stack,
    useRouter: () => ({ back: mockBack, replace: mockReplace }),
    useLocalSearchParams: () => mockParams,
  };
});

const mockSignInScreen = jest.fn(() => null);
jest.mock('../features/auth/screens/SignInScreen.tsx', () => ({
  SignInScreen: () => mockSignInScreen(),
}));

const mockSignUpScreen = jest.fn(() => null);
jest.mock('../features/auth/screens/SignUpScreen.tsx', () => ({
  SignUpScreen: () => mockSignUpScreen(),
}));

const mockWelcomeScreen = jest.fn(() => null);
jest.mock('../features/auth/screens/WelcomeScreen.tsx', () => ({
  WelcomeScreen: () => mockWelcomeScreen(),
}));

const mockForgotPasswordScreen = jest.fn((_props: { onBack: () => void }) => null);
jest.mock('../features/auth/screens/ForgotPasswordScreen.tsx', () => ({
  ForgotPasswordScreen: (props: { onBack: () => void }) => mockForgotPasswordScreen(props),
}));

const mockInviteScreen = jest.fn((_props: { code: string; onSignIn: () => void }) => null);
jest.mock('../features/auth/screens/InviteScreen.tsx', () => ({
  InviteScreen: (props: { code: string; onSignIn: () => void }) => mockInviteScreen(props),
}));

beforeEach(() => {
  mockStackScreenNames.length = 0;
  mockParams = {};
  // `(auth)`'s layout is wrapped in `AuthGate` (`providers-and-gates/03`),
  // which renders nothing at all while the session is still resolving — the
  // store's default. These are composition tests, so put the session in the
  // one state where this group is the permitted one and its screens mount.
  useAuthStore.setState({
    status: 'unauthenticated',
    userId: null,
    role: null,
    isOnboarded: false,
  });
});

describe('(auth)/_layout', () => {
  it('is a Stack, and registers every route in the group', () => {
    render(<AuthLayout />);

    expect(mockStackScreenNames).toEqual([
      'welcome',
      'sign-in',
      'sign-up',
      'complete-social-signup',
      'forgot-password',
      'reset-password/[token]',
      'invite/[code]',
    ]);
  });
});

describe('(auth) routes', () => {
  it('sign-in composes SignInScreen', () => {
    render(<SignInRoute />);
    expect(mockSignInScreen).toHaveBeenCalledTimes(1);
  });

  it('sign-up composes SignUpScreen', () => {
    render(<SignUpRoute />);
    expect(mockSignUpScreen).toHaveBeenCalledTimes(1);
  });

  it('welcome composes WelcomeScreen', () => {
    render(<WelcomeRoute />);
    expect(mockWelcomeScreen).toHaveBeenCalledTimes(1);
  });

  it('forgot-password composes ForgotPasswordScreen and hands it the back navigation', () => {
    render(<ForgotPasswordRoute />);

    expect(mockForgotPasswordScreen).toHaveBeenCalledTimes(1);
    const props = mockForgotPasswordScreen.mock.calls[0]?.[0];
    props?.onBack();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('invite/[code] extracts the code param and passes it through', () => {
    mockParams = { code: 'inv_abc123' };

    render(<InviteRoute />);

    expect(mockInviteScreen).toHaveBeenCalledWith(expect.objectContaining({ code: 'inv_abc123' }));
  });

  it('invite/[code] renders rather than crashing when the param is missing', () => {
    render(<InviteRoute />);

    expect(mockInviteScreen).toHaveBeenCalledWith(expect.objectContaining({ code: '' }));
  });
});
