import { FORBIDDEN_COPY, NOT_FOUND_COPY } from '@coachos/ui';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import NotFoundScreen from '../app/+not-found.tsx';
import { AuthHomeRedirect } from '../features/auth/AuthGate.tsx';
import type { AccessTokenRole } from '../features/auth/jwt.ts';
import { useAuthStore } from '../features/auth/store.ts';

// `phase-05-app-shell/navigation-primitives/02`. Lives outside `src/app`
// deliberately — every `.ts`/`.tsx` under the router root becomes a route
// (see `route-tree.test.tsx`'s own note).

const mockReplace = jest.fn();
const mockPush = jest.fn();

// Rendered as text so the drift check below can read the href
// `AuthHomeRedirect` would navigate to, without a navigator.
const mockRedirect = ({ href }: { href: string }) => <Text>{`redirect:${href}`}</Text>;

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  Redirect: (props: { href: string }) => mockRedirect(props),
}));

/** Each session this route can be reached in, and where its way out goes. */
const CASES = [
  {
    name: 'a coach',
    role: 'coach',
    onboarded: true,
    href: '/(coach)/(tabs)',
    label: 'Back to home',
  },
  // §2: an assistant coach is a coach, and this route must not be the one
  // place that forgets it.
  {
    name: 'an assistant coach',
    role: 'assistant',
    onboarded: true,
    href: '/(coach)/(tabs)',
    label: 'Back to home',
  },
  {
    name: 'a client',
    role: 'client',
    onboarded: true,
    href: '/(client)/(tabs)',
    label: 'Back to today',
  },
  // `onboarding-infrastructure/02` — someone mid-setup has no shell to go
  // back to; sending them to one would bounce them straight off the gate.
  {
    name: 'a coach mid-onboarding',
    role: 'coach',
    onboarded: false,
    href: '/(coach-onboarding)',
    label: 'Back to setup',
  },
  {
    name: 'a client mid-onboarding',
    role: 'client',
    onboarded: false,
    href: '/(client-onboarding)',
    label: 'Back to setup',
  },
] as const satisfies readonly {
  name: string;
  role: AccessTokenRole;
  onboarded: boolean;
  href: string;
  label: string;
}[];

function signIn(role: AccessTokenRole, isOnboarded = true): void {
  useAuthStore.setState({ status: 'authenticated', userId: 'u1', role, isOnboarded });
}

beforeEach(() => {
  mockReplace.mockClear();
  mockPush.mockClear();
  useAuthStore.setState({
    status: 'unauthenticated',
    userId: null,
    role: null,
    isOnboarded: false,
  });
});

describe('the +not-found route', () => {
  it('renders NotFoundState rather than a bare placeholder', () => {
    render(<NotFoundScreen />);

    expect(screen.getByText(NOT_FOUND_COPY.title)).toBeTruthy();
    expect(screen.getByText(NOT_FOUND_COPY.body)).toBeTruthy();
  });

  // A URL matching no route is not a permission failure, and saying so
  // would confirm the route exists (`ERRORS.md` ER§2.1).
  it('never shows the forbidden copy', () => {
    signIn('coach');
    render(<NotFoundScreen />);

    expect(screen.queryByText(FORBIDDEN_COPY.title)).toBeNull();
  });

  it.each(CASES)('sends $name home to $href', ({ role, onboarded, href, label }) => {
    signIn(role, onboarded);
    render(<NotFoundScreen />);

    fireEvent.press(screen.getByLabelText(label));

    expect(mockReplace).toHaveBeenCalledWith(href);
  });

  it('sends a signed-out visitor to the (auth) front door', () => {
    render(<NotFoundScreen />);

    fireEvent.press(screen.getByLabelText('Back to sign in'));

    expect(mockReplace).toHaveBeenCalledWith('/(auth)/welcome');
  });

  // Unreachable in the app — the splash outlasts the bootstrap — but a
  // half-resolved session must still get a way out, never a dead end.
  it('offers the (auth) front door while the session is still resolving', () => {
    useAuthStore.setState({ status: 'loading', userId: null, role: null, isOnboarded: false });
    render(<NotFoundScreen />);

    fireEvent.press(screen.getByLabelText('Back to sign in'));

    expect(mockReplace).toHaveBeenCalledWith('/(auth)/welcome');
  });

  // The URL that matched nothing must not stay on the stack behind Back.
  it('replaces rather than pushes', () => {
    signIn('client');
    render(<NotFoundScreen />);

    fireEvent.press(screen.getByLabelText('Back to today'));

    expect(mockPush).not.toHaveBeenCalled();
  });

  // `AuthGate.GROUP_ROOT` is module-private, so this route restates the
  // five hrefs. This is what stops the copy drifting from the original.
  it.each([
    ...CASES,
    { name: 'a signed-out visitor', role: null, onboarded: false, href: '/(auth)/welcome' },
  ])('agrees with the auth gate about where $name belongs', ({ role, onboarded, href }) => {
    if (role !== null) signIn(role, onboarded);
    render(<AuthHomeRedirect />);

    expect(screen.getByText(`redirect:${href}`)).toBeTruthy();
  });
});
