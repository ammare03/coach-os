import { render, screen } from '@testing-library/react-native';

import { clientVideosQueryKey } from '../../ClientVideosContract.ts';
import { ClientVideosScreen } from '../ClientVideosScreen.tsx';

// P10 ships this facet as a shell: no query, so exactly one reachable state.
// What is worth pinning is therefore not a branch but two promises made to
// `phase-11-media-pipeline` — that the tab owns `['clients', id, 'videos']`
// and nothing else, and that a client with no form checks meets a designed
// empty state rather than a blank screen (`client-detail/04` AC).

const CLIENT_ID = '01924f2c-0000-7000-8000-00000000000a';

describe('ClientVideosScreen', () => {
  it('renders the designed empty state for a client with no form checks', () => {
    render(<ClientVideosScreen clientId={CLIENT_ID} />);

    expect(screen.getByTestId('client-videos-empty')).toBeTruthy();
    expect(screen.getByText('No form checks yet.')).toBeTruthy();
  });

  it('offers no action from the empty state, because the coach has none', () => {
    // `ui-conventions` §4 wants one clear next step and there is none to give:
    // only the client can upload a form check. A button here would be a dead
    // one, which is worse than none (P10 README, "Risks").
    render(<ClientVideosScreen clientId={CLIENT_ID} />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('announces the empty state as a heading rather than as loose text', () => {
    render(<ClientVideosScreen clientId={CLIENT_ID} />);

    expect(screen.getByRole('header', { name: 'No form checks yet.' })).toBeTruthy();
  });

  it('owns the tab cache key `[clients, clientId, videos]`', () => {
    // The one thing P11 must not invent a second time. Hierarchical, so
    // `['clients', clientId]` invalidates this tab with its five siblings and
    // `['clients']` reaches the whole feature (`code-conventions` §5).
    expect(clientVideosQueryKey(CLIENT_ID)).toEqual(['clients', CLIENT_ID, 'videos']);
  });

  it('gives two different clients two different cache entries', () => {
    const other = '01924f2c-0000-7000-8000-00000000000b';

    expect(clientVideosQueryKey(CLIENT_ID)).not.toEqual(clientVideosQueryKey(other));
  });
});
