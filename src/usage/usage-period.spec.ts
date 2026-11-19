import { MONTH_PATTERN, monthOf, parseMonth } from './usage-period.js';

describe('usage periods', () => {
  it('gives the UTC calendar month of an instant', () => {
    expect(monthOf(new Date('2026-11-19T10:00:00.000Z'))).toEqual({
      month: '2026-11',
      start: new Date('2026-11-01T00:00:00.000Z'),
      end: new Date('2026-12-01T00:00:00.000Z'),
    });
  });

  it('rolls December over into the next year', () => {
    expect(parseMonth('2026-12')).toEqual({
      month: '2026-12',
      start: new Date('2026-12-01T00:00:00.000Z'),
      end: new Date('2027-01-01T00:00:00.000Z'),
    });
  });

  it('handles February of a leap year', () => {
    const feb = parseMonth('2028-02');
    expect(feb.end).toEqual(new Date('2028-03-01T00:00:00.000Z'));
  });

  it.each(['2026-1', '2026-13', '2026-00', '26-01', '2026-01-01', ''])(
    'refuses %j',
    (value) => {
      expect(MONTH_PATTERN.test(value)).toBe(false);
      expect(() => parseMonth(value)).toThrow();
    },
  );
});
