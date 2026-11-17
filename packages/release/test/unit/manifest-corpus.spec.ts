import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VersionOutput } from '@releasekit/core';
import { runPipeline, versionOutputToChangelogInput } from '@releasekit/notes';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '../../src/standing-pr/standing-pr.js';

const FIXTURES = join(import.meta.dirname, '../fixtures/manifests');

// The wrapper every release so far has written, kept literal so a change to serializeManifest can't hide a break.
function manifestComment(manifest: unknown): string {
  const encoded = Buffer.from(JSON.stringify(manifest)).toString('base64');
  return [
    '<!-- releasekit-manifest -->',
    '<details><summary>Release manifest (do not edit)</summary>',
    '',
    `<!-- base64 ${encoded} -->`,
    '',
    '</details>',
  ].join('\n');
}

const fixtures = readdirSync(FIXTURES).filter((file) => file.endsWith('.json'));

describe.each(fixtures)('the manifest persisted in %s', (file) => {
  const persisted = JSON.parse(readFileSync(join(FIXTURES, file), 'utf-8')) as { versionOutput: VersionOutput };

  it('should parse', () => {
    expect(() => parseManifest(manifestComment(persisted))).not.toThrow();
  });

  // The notes step a merged standing PR's publish runs, with no changelog write or LLM.
  it('should render release notes for every package', async () => {
    const { versionOutput } = parseManifest(manifestComment(persisted));

    const result = await runPipeline(
      versionOutputToChangelogInput(versionOutput),
      { changelog: false, releaseNotes: {} },
      true,
    );

    const names = [...new Set(versionOutput.changelogs.map((c) => c.packageName))].sort();
    expect(Object.keys(result.releaseNotes ?? {}).sort()).toEqual(names);
  });
});
