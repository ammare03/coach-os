import { render, screen } from '@testing-library/react-native';

import HomeScreen from './index';

describe('HomeScreen', () => {
  it('renders without an ESM transform error', () => {
    render(<HomeScreen />);

    expect(screen.getByText('CoachOS')).toBeTruthy();
  });
});
