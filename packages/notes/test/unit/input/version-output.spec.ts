import type { VersionOutput } from '@releasekit/core';
import { describe, expect, it } from 'vitest';
import { parseVersionOutput, versionOutputToChangelogInput } from '../../../src/input/version-output.js';

const baseVersionOutput: VersionOutput = {
  dryRun: false,
  updates: [],
  tags: [],
  changelogs: [
    {
      packageName: '@scope/my-package',
      version: '2.0.0',
      previousVersion: '1.0.0',
      revisionRange: 'v1.0.0..v2.0.0',
      repoUrl: 'https://github.com/owner/repo',
      entries: [
        {
          type: 'feat',
          description: 'New feature',
          issueIds: [],
          scope: undefined,
          originalType: 'feat',
          breaking: false,
        },
      ],
    },
  ],
};

describe('versionOutputToChangelogInput', () => {
  it('should map package fields correctly', () => {
    const result = versionOutputToChangelogInput(baseVersionOutput);

    expect(result.source).toBe('version');
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]?.packageName).toBe('@scope/my-package');
    expect(result.packages[0]?.version).toBe('2.0.0');
    expect(result.packages[0]?.previousVersion).toBe('1.0.0');
    expect(result.packages[0]?.revisionRange).toBe('v1.0.0..v2.0.0');
    expect(result.packages[0]?.repoUrl).toBe('https://github.com/owner/repo');
  });

  it('should set date to today', () => {
    const today = new Date().toISOString().split('T')[0];
    const result = versionOutputToChangelogInput(baseVersionOutput);
    expect(result.packages[0]?.date).toBe(today);
  });

  it('should normalize entry types', () => {
    const input: VersionOutput = {
      ...baseVersionOutput,
      changelogs: [
        {
          ...baseVersionOutput.changelogs[0],
          entries: [
            { type: 'feat', description: 'Feature', issueIds: [], breaking: false },
            { type: 'fix', description: 'Fix', issueIds: [], breaking: false },
            { type: 'refactor', description: 'Refactor', issueIds: [], breaking: false },
            { type: 'security', description: 'Security', issueIds: [], breaking: false },
            { type: 'unknown', description: 'Unknown', issueIds: [], breaking: false },
          ],
        },
      ],
    };

    const result = versionOutputToChangelogInput(input);
    const types = result.packages[0]?.entries.map((e) => e.type);
    expect(types).toEqual(['added', 'fixed', 'changed', 'security', 'changed']);
  });

  it('should map entry fields correctly', () => {
    const input: VersionOutput = {
      ...baseVersionOutput,
      changelogs: [
        {
          ...baseVersionOutput.changelogs[0],
          entries: [
            {
              type: 'feat',
              description: 'Feature',
              issueIds: ['#123', '#456'],
              scope: 'api',
              originalType: 'feat',
              breaking: true,
            },
          ],
        },
      ],
    };

    const result = versionOutputToChangelogInput(input);
    const entry = result.packages[0]?.entries[0];
    expect(entry?.description).toBe('Feature');
    expect(entry?.issueIds).toEqual(['#123', '#456']);
    expect(entry?.scope).toBe('api');
    expect(entry?.originalType).toBe('feat');
    expect(entry?.breaking).toBe(true);
  });

  it('should detect breaking from originalType containing "!" when breaking is not set', () => {
    const input: VersionOutput = {
      ...baseVersionOutput,
      changelogs: [
        {
          ...baseVersionOutput.changelogs[0],
          entries: [{ type: 'feat', description: 'Breaking change', issueIds: [], originalType: 'feat!' }],
        },
      ],
    };

    const result = versionOutputToChangelogInput(input);
    expect(result.packages[0]?.entries[0]?.breaking).toBe(true);
  });

  it('should respect explicit breaking: false over originalType "!"', () => {
    const input: VersionOutput = {
      ...baseVersionOutput,
      changelogs: [
        {
          ...baseVersionOutput.changelogs[0],
          entries: [
            { type: 'feat', description: 'Not breaking', issueIds: [], originalType: 'feat!', breaking: false },
          ],
        },
      ],
    };

    const result = versionOutputToChangelogInput(input);
    expect(result.packages[0]?.entries[0]?.breaking).toBe(false);
  });

  it('should extract repoUrl from first package into metadata', () => {
    const result = versionOutputToChangelogInput(baseVersionOutput);
    expect(result.metadata?.repoUrl).toBe('https://github.com/owner/repo');
  });

  it('should handle missing repoUrl gracefully', () => {
    const input: VersionOutput = {
      ...baseVersionOutput,
      changelogs: [{ ...baseVersionOutput.changelogs[0], repoUrl: null }],
    };

    const result = versionOutputToChangelogInput(input);
    expect(result.metadata?.repoUrl).toBeUndefined();
  });

  it('should handle multiple packages', () => {
    const input: VersionOutput = {
      ...baseVersionOutput,
      changelogs: [
        { ...baseVersionOutput.changelogs[0], packageName: 'pkg-a', version: '1.1.0', entries: [] },
        { ...baseVersionOutput.changelogs[0], packageName: 'pkg-b', version: '2.0.0', entries: [] },
      ],
    };

    const result = versionOutputToChangelogInput(input);
    expect(result.packages).toHaveLength(2);
    expect(result.packages[0]?.packageName).toBe('pkg-a');
    expect(result.packages[1]?.packageName).toBe('pkg-b');
  });

  it('should throw InputParseError when changelogs is missing', () => {
    expect(() => versionOutputToChangelogInput({} as VersionOutput)).toThrow('changelogs');
  });

  it('should throw InputParseError when changelogs is not an array', () => {
    expect(() => versionOutputToChangelogInput({ changelogs: 'bad' } as unknown as VersionOutput)).toThrow(
      'changelogs',
    );
  });
});

describe('parseVersionOutput', () => {
  it('should parse valid JSON and delegate to versionOutputToChangelogInput', () => {
    const result = parseVersionOutput(JSON.stringify(baseVersionOutput));
    expect(result.source).toBe('version');
    expect(result.packages[0]?.packageName).toBe('@scope/my-package');
  });

  it('should throw on invalid JSON', () => {
    expect(() => parseVersionOutput('not valid json')).toThrow('Invalid JSON input');
  });
});
