import * as fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isCargoToml, parseCargoToml } from '../../src/cargo.js';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

const mockedFs = vi.mocked(fs);

describe('parseCargoToml', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse valid Cargo.toml content', () => {
    mockedFs.readFileSync.mockReturnValue(`
      [package]
      name = "my-crate"
      version = "1.0.0"
      
      [dependencies]
      serde = "1.0"
    `);

    const result = parseCargoToml('/path/to/Cargo.toml');

    expect(result.package?.name).toBe('my-crate');
    expect(result.package?.version).toBe('1.0.0');
    expect(result.dependencies?.serde).toBe('1.0');
  });

  it('should parse minimal Cargo.toml', () => {
    mockedFs.readFileSync.mockReturnValue(`
      [package]
      name = "minimal"
    `);

    const result = parseCargoToml('/path/to/Cargo.toml');

    expect(result.package?.name).toBe('minimal');
  });

  it('should parse complex dependencies', () => {
    mockedFs.readFileSync.mockReturnValue(`
      [dependencies]
      serde = { version = "1.0", features = ["derive"] }
      tokio = { version = "1.0", optional = true }
    `);

    const result = parseCargoToml('/path/to/Cargo.toml');

    expect(result.dependencies?.serde).toEqual({ version: '1.0', features: ['derive'] });
    expect(result.dependencies?.tokio).toEqual({ version: '1.0', optional: true });
  });

  it('should parse dev and build dependencies', () => {
    mockedFs.readFileSync.mockReturnValue(`
      [dev-dependencies]
      tempfile = "3.0"
      
      [build-dependencies]
      cc = "1.0"
    `);

    const result = parseCargoToml('/path/to/Cargo.toml');

    expect((result as Record<string, unknown>)['dev-dependencies']).toEqual({ tempfile: '3.0' });
    expect((result as Record<string, unknown>)['build-dependencies']).toEqual({ cc: '1.0' });
  });

  it('should read a file from the specified path', () => {
    mockedFs.readFileSync.mockReturnValue('[package]\nname = "test"');

    parseCargoToml('/custom/path/Cargo.toml');

    expect(mockedFs.readFileSync).toHaveBeenCalledWith('/custom/path/Cargo.toml', 'utf-8');
  });
});

describe('isCargoToml', () => {
  it('should return true for Cargo.toml', () => {
    expect(isCargoToml('Cargo.toml')).toBe(true);
    expect(isCargoToml('/path/to/Cargo.toml')).toBe(true);
    expect(isCargoToml('./relative/Cargo.toml')).toBe(true);
  });

  it('should return false for other files', () => {
    expect(isCargoToml('package.json')).toBe(false);
    expect(isCargoToml('Cargo.lock')).toBe(false);
    expect(isCargoToml('cargo.toml')).toBe(false);
    expect(isCargoToml('CARGO.TOML')).toBe(false);
  });

  it('should handle edge cases', () => {
    expect(isCargoToml('')).toBe(false);
    expect(isCargoToml('/')).toBe(false);
  });
});
