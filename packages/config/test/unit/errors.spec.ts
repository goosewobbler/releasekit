import { describe, expect, it } from 'vitest';
import { ConfigError } from '../../src/errors.js';

describe('ConfigError', () => {
  it('extends Error', () => {
    const error = new ConfigError('Test message');
    expect(error).toBeInstanceOf(Error);
  });

  it('has code property', () => {
    const error = new ConfigError('Test message');
    expect(error.code).toBe('CONFIG_ERROR');
  });

  it('has default suggestions', () => {
    const error = new ConfigError('Test message');
    expect(error.suggestions).toContain('Check that releasekit.config.json exists and is valid JSON');
    expect(error.suggestions).toContain('Run with --verbose for more details');
  });

  it('accepts custom suggestions', () => {
    const error = new ConfigError('Test message', ['Custom suggestion 1', 'Custom suggestion 2']);
    expect(error.suggestions).toEqual(['Custom suggestion 1', 'Custom suggestion 2']);
  });

  it('preserves message', () => {
    const error = new ConfigError('Something went wrong');
    expect(error.message).toBe('Something went wrong');
  });

  it('has correct name', () => {
    const error = new ConfigError('Test message');
    expect(error.name).toBe('ConfigError');
  });
});
