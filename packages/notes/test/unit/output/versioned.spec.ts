import * as fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemplateContext } from '../../../src/core/types.js';
import { writeVersionedNotes } from '../../../src/output/versioned.js';

vi.mock('node:fs', () => ({
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

// Stand-in for the pipeline's content resolver — proves the writer writes whatever it returns.
const render = (ctx: TemplateContext): string => `notes for ${ctx.packageName} ${ctx.version}`;

describe('writeVersionedNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should write a flat release-notes/<version>.md when not nested (single-package repo)', () => {
    const written = writeVersionedNotes([makeContext({ version: '1.2.0' })], 'release-notes', false, false, render);

    expect(written).toEqual(['release-notes/1.2.0.md']);
    const [filePath, content] = mockedFs.writeFileSync.mock.calls[0] as [string, string];
    expect(filePath).toBe('release-notes/1.2.0.md');
    expect(content).toBe('notes for pkg 1.2.0');
  });

  it('should write exactly the content the resolver returns (no changelog wrapping)', () => {
    writeVersionedNotes(
      [makeContext({ version: '1.0.0' })],
      'release-notes',
      false,
      false,
      () => '---\nfoo: bar\n---\nBody',
    );

    const [, content] = mockedFs.writeFileSync.mock.calls[0] as [string, string];
    expect(content).toBe('---\nfoo: bar\n---\nBody');
    expect(content).not.toContain('# Changelog');
  });

  it('should nest by package even for a single context when nested', () => {
    // Regression for the independent-monorepo collision: one context per run must still nest, so two
    // packages that share a version (e.g. both 1.0.0) don't overwrite release-notes/1.0.0.md.
    const written = writeVersionedNotes(
      [makeContext({ packageName: '@scope/pkg-a', version: '1.0.0' })],
      'release-notes',
      false,
      true,
      render,
    );

    expect(written).toEqual(['release-notes/@scope/pkg-a/1.0.0.md']);
    expect(mockedFs.mkdirSync).toHaveBeenCalledWith('release-notes/@scope/pkg-a', { recursive: true });
  });

  it('should write nested files per package for a multi-package release', () => {
    const written = writeVersionedNotes(
      [
        makeContext({ packageName: '@scope/pkg-a', version: '1.1.0' }),
        makeContext({ packageName: '@scope/pkg-b', version: '2.0.0' }),
      ],
      'release-notes',
      false,
      true,
      render,
    );

    expect(written).toEqual(['release-notes/@scope/pkg-a/1.1.0.md', 'release-notes/@scope/pkg-b/2.0.0.md']);
    expect(mockedFs.mkdirSync).toHaveBeenCalledWith('release-notes/@scope/pkg-a', { recursive: true });
    expect(mockedFs.mkdirSync).toHaveBeenCalledWith('release-notes/@scope/pkg-b', { recursive: true });
  });

  it('should honor a custom output directory', () => {
    const written = writeVersionedNotes([makeContext({ version: '3.0.0' })], 'docs/notes', false, false, render);

    expect(written).toEqual(['docs/notes/3.0.0.md']);
  });

  it('should not write anything in dry-run mode', () => {
    const written = writeVersionedNotes([makeContext({ version: '1.0.0' })], 'release-notes', true, false, render);

    expect(written).toEqual([]);
    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
    expect(mockedFs.mkdirSync).not.toHaveBeenCalled();
  });
});
