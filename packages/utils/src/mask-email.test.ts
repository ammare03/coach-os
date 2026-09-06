import { maskEmail } from './mask-email.ts';

describe('maskEmail', () => {
  it('keeps one character of the local part and the whole domain', () => {
    expect(maskEmail('jane.doe@gmail.com')).toBe('j•••@gmail.com');
  });

  it('masks a single-character local part without revealing its length', () => {
    expect(maskEmail('j@gmail.com')).toBe('j•••@gmail.com');
  });

  it('never reveals more of the local part than its first character', () => {
    const masked = maskEmail('priya.sharma.1998@outlook.co.in');
    expect(masked).toBe('p•••@outlook.co.in');
    expect(masked).not.toContain('sharma');
  });

  it('splits on the LAST @, so a quoted local part cannot leak the rest', () => {
    expect(maskEmail('a@b@example.com')).toBe('a•••@example.com');
  });

  it.each(['', 'not-an-address', '@gmail.com', 'jane@'])(
    'masks %p entirely rather than returning it',
    (input) => {
      expect(maskEmail(input)).toBe('•••');
    },
  );
});
