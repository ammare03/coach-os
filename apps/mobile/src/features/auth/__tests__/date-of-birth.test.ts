import { parseDateOfBirthInput } from '../date-of-birth.ts';

describe('parseDateOfBirthInput', () => {
  it('converts DD/MM/YYYY to YYYY-MM-DD', () => {
    expect(parseDateOfBirthInput('05/09/1998')).toBe('1998-09-05');
  });

  it('tolerates spaces around the slashes, matching the placeholder', () => {
    expect(parseDateOfBirthInput('5 / 9 / 1998')).toBe('1998-09-05');
  });

  it('pads single-digit day and month', () => {
    expect(parseDateOfBirthInput('5/9/1998')).toBe('1998-09-05');
  });

  it.each(['1998-09-05', '05-09-1998', '05/09/98', 'not a date', ''])(
    'returns null for %s',
    (input) => {
      expect(parseDateOfBirthInput(input)).toBeNull();
    },
  );
});
