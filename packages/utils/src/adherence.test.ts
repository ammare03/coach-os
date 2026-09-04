import { ADHERENCE_TOKEN, adherenceState } from './adherence.ts';

// Every threshold boundary, both sides — off-by-one on a threshold is
// invisible in a screenshot and obvious in a test (theme-tokens/05 approach §1).
describe('adherenceState', () => {
  it('is no-data for null, and null only', () => {
    expect(adherenceState(null)).toBe('no-data');
  });

  it('is on-track at and above 85', () => {
    expect(adherenceState(85)).toBe('on-track');
    expect(adherenceState(100)).toBe('on-track');
  });

  it('is drifting just under 85, down to 70', () => {
    expect(adherenceState(84.9)).toBe('drifting');
    expect(adherenceState(70)).toBe('drifting');
  });

  it('is off-track just under 70, and at 0', () => {
    expect(adherenceState(69.9)).toBe('off-track');
    expect(adherenceState(0)).toBe('off-track');
  });

  it('maps every state to its DS§2.5 token name', () => {
    expect(ADHERENCE_TOKEN['on-track']).toBe('onTrack');
    expect(ADHERENCE_TOKEN.drifting).toBe('drifting');
    expect(ADHERENCE_TOKEN['off-track']).toBe('offTrack');
    expect(ADHERENCE_TOKEN['no-data']).toBe('noData');
  });
});
