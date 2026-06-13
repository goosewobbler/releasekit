import * as fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemplateContext } from '../../../src/core/types.js';
import { writeVersionedNotes } from '../../../src/output/versioned.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

const mockedFs = vi.mocked(fs);

function makeContext(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    packageName: 'pkg',
    version: '1.0.0',
    previousVersion: null,
    date: '2024-01-15',
    entries: [{ type: 'added', description: 'A feature' }],
    repoUrl: null,
    ...overrides,
  };
}

describe('writeVersionedNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFs.existsSync.mockReturnValue(false);
  });

  it('should write a flat release-notes/<version>.md for a single package', () => {
    const written = writeVersionedNotes([makeContext({ version: '1.2.0' })], 'release-notes', false);

    expect(written).toEqual(['release-notes/1.2.0.md']);
    const [filePath, content] = mockedFs.writeFileSync.mock.calls[0] as [string, string];
    expect(filePath).toBe('release-notes/1.2.0.md');
    expect(content).toContain('1.2.0');
  });

  it('should write nested release-notes/<package>/<version>.md for a monorepo release', () => {
    const written = writeVersionedNotes(
      [
        makeContext({ packageName: '@scope/pkg-a', version: '1.1.0' }),
        makeContext({ packageName: '@scope/pkg-b', version: '2.0.0' }),
      ],
      'release-notes',
      false,
    );

    expect(written).toEqual(['release-notes/@scope/pkg-a/1.1.0.md', 'release-notes/@scope/pkg-b/2.0.0.md']);
    // Each package directory is created recursively.
    expect(mockedFs.mkdirSync).toHaveBeenCalledWith('release-notes/@scope/pkg-a', { recursive: true });
    expect(mockedFs.mkdirSync).toHaveBeenCalledWith('release-notes/@scope/pkg-b', { recursive: true });
  });

  it('should honor a custom output directory', () => {
    const written = writeVersionedNotes([makeContext({ version: '3.0.0' })], 'docs/notes', false);

    expect(written).toEqual(['docs/notes/3.0.0.md']);
  });

  it('should not write anything in dry-run mode', () => {
    const written = writeVersionedNotes([makeContext({ version: '1.0.0' })], 'release-notes', true);

    expect(written).toEqual([]);
    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
    expect(mockedFs.mkdirSync).not.toHaveBeenCalled();
  });
});
