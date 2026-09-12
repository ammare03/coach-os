import { fireEvent, render, screen } from '@testing-library/react-native';

import { UnsyncedWorkPrompt } from '../UnsyncedWorkPrompt.tsx';

// `account-actions/01`, Approach step 2 — this dialog exists for one reason:
// DB§13 refuses a wipe that would destroy unsynced work, and the refusal has
// to become a choice rather than a silence. Every assertion below is a way
// someone could turn that choice back into a default.
describe('UnsyncedWorkPrompt', () => {
  const base = { onKeepSignedIn: jest.fn(), onDiscard: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

  it('renders nothing until there is a count to name', () => {
    render(<UnsyncedWorkPrompt {...base} pendingCount={null} />);

    expect(screen.queryByText(/synced/)).toBeNull();
  });

  it('names the count, because "some work" is not a fact a person can weigh', () => {
    render(<UnsyncedWorkPrompt {...base} pendingCount={3} />);

    expect(screen.getByText('3 entries haven’t synced yet')).toBeTruthy();
  });

  it('says entry, not entries, for one', () => {
    render(<UnsyncedWorkPrompt {...base} pendingCount={1} />);

    expect(screen.getByText('1 entry hasn’t synced yet')).toBeTruthy();
  });

  it('leads with keeping the session — the safe choice is never the second one', () => {
    render(<UnsyncedWorkPrompt {...base} pendingCount={3} />);

    const actions = screen
      .getAllByText(/^(Keep me signed in|Discard and sign out)$/)
      .map((node) => node.props.children);

    expect(actions).toEqual(['Keep me signed in', 'Discard and sign out']);
  });

  it('keeps the user signed in and discards nothing', () => {
    render(<UnsyncedWorkPrompt {...base} pendingCount={3} />);

    fireEvent.press(screen.getByText('Keep me signed in'));

    expect(base.onKeepSignedIn).toHaveBeenCalledTimes(1);
    expect(base.onDiscard).not.toHaveBeenCalled();
  });

  it('discards only when the destructive action is the one chosen', () => {
    render(<UnsyncedWorkPrompt {...base} pendingCount={3} />);

    fireEvent.press(screen.getByText('Discard and sign out'));

    expect(base.onDiscard).toHaveBeenCalledTimes(1);
    expect(base.onKeepSignedIn).not.toHaveBeenCalled();
  });

  // `COPY.md` §CO6 / `product-copy` §3: it states a fact and offers two
  // choices. It does not ask a question the product already knows the answer
  // to, and it does not put the failure on the person holding the phone.
  it('asks no question and blames nobody', () => {
    render(<UnsyncedWorkPrompt {...base} pendingCount={2} />);

    const body = screen.getByText(/saved on this phone/);
    const words = `${String(screen.getByText(/synced yet$/).props.children)} ${String(body.props.children)}`;

    expect(words).not.toMatch(/\?|!/);
    expect(words).not.toMatch(/\byou(r)?\b/i);
    expect(words).not.toMatch(/sure|lost|warning|failed|error/i);
  });

  it('offers no third way out — closing it is choosing to stay signed in', () => {
    render(<UnsyncedWorkPrompt {...base} pendingCount={3} />);

    expect(screen.queryByText('Cancel')).toBeNull();
    expect(screen.queryByText('Sign out')).toBeNull();
  });
});
