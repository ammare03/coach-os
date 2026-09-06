import { render, screen } from '@testing-library/react-native';

import { StepProgress } from '../components/StepProgress.tsx';

describe('StepProgress', () => {
  it('states the position in words as well as segments', () => {
    render(<StepProgress total={4} current={2} />);

    // `DESIGN.md` §13 — every state carries a second, non-colour channel.
    // A filled bar alone is unreadable to a screen reader and to anyone
    // who cannot resolve the fill against the track.
    expect(screen.getByText('Step 2 of 4')).toBeTruthy();
    expect(screen.getByLabelText('Step 2 of 4')).toBeTruthy();
  });

  it('clamps a position outside the flow rather than rendering it', () => {
    // A draft written by an older build can carry a step this build no
    // longer has (`coach-steps.ts`'s own clamp) — the indicator must not
    // then say "Step 0 of 4" or "Step 9 of 4".
    render(<StepProgress total={4} current={0} />);
    expect(screen.getByText('Step 1 of 4')).toBeTruthy();

    screen.unmount();

    render(<StepProgress total={4} current={9} />);
    expect(screen.getByText('Step 4 of 4')).toBeTruthy();
  });
});
