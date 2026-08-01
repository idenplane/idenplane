import { describe, it, expect } from 'vitest';
import { formatDuration } from '../formatDuration';

describe('formatDuration', () => {
  it('formats seconds under a minute', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(1)).toBe('1s');
    expect(formatDuration(59)).toBe('59s');
  });

  it('formats minutes at the 60s boundary and below an hour', () => {
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(90)).toBe('1m');
    expect(formatDuration(3599)).toBe('59m');
  });

  it('formats hours at the 3600s boundary and below a day', () => {
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(7200)).toBe('2h');
    expect(formatDuration(86399)).toBe('23h');
  });

  it('formats days at the 86400s boundary and above', () => {
    expect(formatDuration(86400)).toBe('1d');
    expect(formatDuration(172800)).toBe('2d');
    expect(formatDuration(2592000)).toBe('30d');
  });
});
