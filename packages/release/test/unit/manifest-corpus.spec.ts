import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VersionOutput } from '@releasekit/core';
import { createTemplateContext, renderMarkdown, versionOutputToChangelogInput } from '@releasekit/notes';
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

describe.each(readdirSync(FIXTURES))('the manifest persisted in %s', (file) => {
  const persisted = JSON.parse(readFileSync(join(FIXTURES, file), 'utf-8')) as { versionOutput: VersionOutput };

  it('should parse unchanged', () => {
    expect(parseManifest(manifestComment(persisted))).toEqual(persisted);
  });

  it("should render every package's changelog", () => {
    const { versionOutput } = parseManifest(manifestComment(persisted));
    const contexts = versionOutputToChangelogInput(versionOutput).packages.map(createTemplateContext);
    const markdown = renderMarkdown(contexts);

    for (const changelog of versionOutput.changelogs) {
      expect(markdown).toContain(`## [${changelog.version}]`);
    }
  });
});
