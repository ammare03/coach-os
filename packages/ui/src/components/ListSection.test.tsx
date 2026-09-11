import { render, screen } from '@testing-library/react-native';

import { ListRow } from './ListRow.tsx';
import { ListSection } from './ListSection.tsx';

describe('ListSection', () => {
  it('renders nothing at all when it has no rows', () => {
    const showsRow = false;
    render(
      <ListSection title="Notifications" testID="section">
        {showsRow ? <ListRow label="Push" onPress={jest.fn()} /> : null}
      </ListSection>,
    );

    // A reserved section name costs no pixels until the phase that owns it
    // arrives (`settings-shell/01`, Risks).
    expect(screen.queryByTestId('section')).toBeNull();
    expect(screen.queryByText('Notifications')).toBeNull();
  });

  it('announces its eyebrow as a header so a screen reader can jump sections', () => {
    render(
      <ListSection title="Your data">
        <ListRow label="Your data" onPress={jest.fn()} />
      </ListSection>,
    );

    expect(screen.getByRole('header', { name: 'Your data' })).toBeTruthy();
  });

  it('keeps the eyebrow string in sentence case — the casing is a style', () => {
    render(
      <ListSection title="Help and about">
        <ListRow label="Medical disclaimer" onPress={jest.fn()} />
      </ListSection>,
    );

    expect(screen.getByText('Help and about')).toBeTruthy();
  });

  it('renders every row it is given, in order', () => {
    render(
      <ListSection title="Help and about">
        <ListRow label="Medical disclaimer" onPress={jest.fn()} />
        <ListRow label="App version" trailing={{ kind: 'value', value: '1.0.0' }} />
      </ListSection>,
    );

    expect(screen.getByRole('button', { name: 'Medical disclaimer' })).toBeTruthy();
    expect(screen.getByLabelText('App version, 1.0.0')).toBeTruthy();
  });

  it('takes a child that brings its own surface, ungrouped', () => {
    render(
      <ListSection title="Preferences" grouped={false}>
        <ListRow label="Weight unit" trailing={{ kind: 'value', value: 'kg' }} />
      </ListSection>,
    );

    expect(screen.getByLabelText('Weight unit, kg')).toBeTruthy();
  });
});
