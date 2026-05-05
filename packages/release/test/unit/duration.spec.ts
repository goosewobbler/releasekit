import { describe, expect, it } from 'vitest';
import { formatDuration, parseDuration } from '../../src/duration.js';

describe('parseDuration', () => {
  it('should parse seconds', () => {
    expect(parseDuration('45s')).toBe(45_000);
  });

  it('should parse minutes', () => {
    expect(parseDuration('30m')).toBe(1_800_000);
  });

  it('should parse hours', () => {
    expect(parseDuration('6h')).toBe(21_600_000);
  });

  it('should parse days', () => {
    expect(parseDuration('1d')).toBe(86_400_000);
  });

  it('should parse multi-digit values', () => {
    expect(parseDuration('24h')).toBe(86_400_000);
    expect(parseDuration('90m')).toBe(5_400_000);
  });

  it('should return null for empty string', () => {
    expect(parseDuration('')).toBeNull();
  });

  it('should return null for unknown unit', () => {
    expect(parseDuration('1x')).toBeNull();
    expect(parseDuration('1y')).toBeNull();
  });

  it('should return null for missing unit', () => {
    expect(parseDuration('60')).toBeNull();
  });

  it('should return null for non-numeric prefix', () => {
    expect(parseDuration('fiveH')).toBeNull();
    expect(parseDuration('abch')).toBeNull();
  });

  it('should return null for mixed invalid input', () => {
    expect(parseDuration('1h30m')).toBeNull();
    expect(parseDuration(' 1h')).toBeNull();
  });
});

describe('formatDuration', () => {
  it('should format hours and minutes', () => {
    expect(formatDuration(2 * 3_600_000 + 15 * 60_000)).toBe('2h 15m');
  });

  it('should format hours only', () => {
    expect(formatDuration(3 * 3_600_000)).toBe('3h');
  });

  it('should format minutes only', () => {
    expect(formatDuration(45 * 60_000)).toBe('45m');
  });

  it('should format seconds when less than a minute', () => {
    expect(formatDuration(30_000)).toBe('30s');
  });

  it('rounds up partial seconds', () => {
    expect(formatDuration(500)).toBe('1s');
  });
});
