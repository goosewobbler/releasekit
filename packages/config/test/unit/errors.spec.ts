import { describe, expect, it } from 'vitest';
import { ConfigError } from '../../src/errors.js';

describe('ConfigError', () => {
  it('should extend Error', () => {
    const error = new ConfigError('Test message');
    expect(error).toBeInstanceOf(Error);
  });

  it('should have a code property', () => {
    const error = new ConfigError('Test message');
    expect(error.code).toBe('CONFIG_ERROR');
  });

  it('should have default suggestions', () => {
    const error = new ConfigError('Test message');
    expect(error.suggestions).toContain('Check that releasekit.config.json exists and is valid JSON');
    expect(error.suggestions).toContain('Run with --verbose for more details');
  });

  it('should have the correct name', () => {
    const error = new ConfigError('Test message');
    expect(error.name).toBe('ConfigError');
  });
});
