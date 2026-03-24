import * as fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemplateContext } from '../../../src/core/types.js';
import { aggregateToRoot, detectMonorepo } from '../../../src/monorepo/aggregator.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn(),
}));

const mockedFs = vi.mocked(fs);

function makeContext(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    packageName: 'pkg',
    version: '1.0.0',
    previousVersion: null,
    date: '2024-01-15',
    entries: [],
    repoUrl: null,
    ...overrides,
  };
}

describe('aggregateToRoot', () => {
  it('combines entries from multiple packages', () => {
    const contexts = [
      makeContext({
        packageName: '@scope/pkg-a',
        entries: [
          { type: 'added', description: 'Feature A' },
          { type: 'fixed', description: 'Fix A' },
        ],
      }),
      makeContext({
        packageName: '@scope/pkg-b',
        entries: [{ type: 'added', description: 'Feature B' }],
      }),
    ];

    const result = aggregateToRoot(contexts);

    expect(result.packageName).toBe('monorepo');
    expect(result.entries).toHaveLength(3);
  });

  it('prefixes scope with package name', () => {
    const contexts = [
      makeContext({
        packageName: '@scope/pkg-a',
        entries: [{ type: 'added', description: 'Feature', scope: 'api' }],
      }),
    ];

    const result = aggregateToRoot(contexts);

    expect(result.entries[0]?.scope).toBe('@scope/pkg-a/api');
  });

  it('uses package name as scope when entry has no scope', () => {
    const contexts = [
      makeContext({
        packageName: '@scope/pkg-a',
        entries: [{ type: 'added', description: 'Feature' }],
      }),
    ];

    const result = aggregateToRoot(contexts);

    expect(result.entries[0]?.scope).toBe('@scope/pkg-a');
  });

  it('uses version from first context', () => {
    const contexts = [
      makeContext({ version: '2.0.0', previousVersion: '1.0.0' }),
      makeContext({ version: '3.0.0', previousVersion: '2.0.0' }),
    ];

    const result = aggregateToRoot(contexts);

    expect(result.version).toBe('2.0.0');
    expect(result.previousVersion).toBe('1.0.0');
  });

  it('should handle empty contexts array', () => {
    const result = aggregateToRoot([]);

    expect(result.packageName).toBe('monorepo');
    expect(result.version).toBe('0.0.0');
    expect(result.entries).toEqual([]);
  });
});

describe('detectMonorepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should detect pnpm monorepo from pnpm-workspace.yaml', () => {
    mockedFs.existsSync.mockImplementation((path) => {
      return path.toString().includes('pnpm-workspace.yaml');
    });
    mockedFs.readFileSync.mockReturnValue(`
packages:
  - 'packages/*'
`);

    const result = detectMonorepo('/project');

    expect(result.isMonorepo).toBe(true);
    expect(result.packagesPath).toBe('packages');
  });

  it('should detect npm/yarn workspaces from package.json', () => {
    mockedFs.existsSync.mockImplementation((path) => {
      return path.toString().includes('package.json') && !path.toString().includes('pnpm-workspace');
    });
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        workspaces: ['packages/*'],
      }),
    );

    const result = detectMonorepo('/project');

    expect(result.isMonorepo).toBe(true);
    expect(result.packagesPath).toBe('packages');
  });

  it('should detect yarn 2 workspaces format', () => {
    mockedFs.existsSync.mockImplementation((path) => {
      return path.toString().includes('package.json') && !path.toString().includes('pnpm-workspace');
    });
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        workspaces: {
          packages: ['packages/*'],
        },
      }),
    );

    const result = detectMonorepo('/project');

    expect(result.isMonorepo).toBe(true);
    expect(result.packagesPath).toBe('packages');
  });

  it('should return false for non-monorepo', () => {
    mockedFs.existsSync.mockReturnValue(false);

    const result = detectMonorepo('/project');

    expect(result.isMonorepo).toBe(false);
    expect(result.packagesPath).toBe('');
  });

  it('should extract packages path from glob patterns', () => {
    mockedFs.existsSync.mockImplementation((path) => {
      return path.toString().includes('pnpm-workspace.yaml');
    });
    mockedFs.readFileSync.mockReturnValue(`
packages:
  - "apps/*"
`);

    const result = detectMonorepo('/project');

    expect(result.packagesPath).toBe('apps');
  });

  it('should handle nested glob patterns', () => {
    mockedFs.existsSync.mockImplementation((path) => {
      return path.toString().includes('pnpm-workspace.yaml');
    });
    mockedFs.readFileSync.mockReturnValue(`
packages:
  - 'packages/**'
`);

    const result = detectMonorepo('/project');

    expect(result.packagesPath).toBe('packages/*');
  });

  it('defaults to packages when glob pattern is invalid', () => {
    mockedFs.existsSync.mockImplementation((path) => {
      return path.toString().includes('pnpm-workspace.yaml');
    });
    mockedFs.readFileSync.mockReturnValue(`
packages:
  - '*'
`);

    const result = detectMonorepo('/project');

    expect(result.packagesPath).toBe('packages');
  });

  it('should handle invalid JSON in package.json gracefully', () => {
    mockedFs.existsSync.mockImplementation((path) => {
      return path.toString().includes('package.json') && !path.toString().includes('pnpm-workspace');
    });
    mockedFs.readFileSync.mockReturnValue('invalid json');

    const result = detectMonorepo('/project');

    expect(result.isMonorepo).toBe(false);
  });
});
