import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderConfigDocs, type Schema } from '../../../../scripts/generate-config-docs.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const schema = JSON.parse(readFileSync(resolve(ROOT, 'releasekit.schema.json'), 'utf8')) as Schema;

describe('generate-config-docs', () => {
  describe('renderConfigDocs()', () => {
    const docs = renderConfigDocs(schema);

    it('should give each nested object its own section listing its keys', () => {
      expect(docs).toContain('#### `ci.standingPr.authorization`');
      expect(docs).toMatch(/^\| `requiredPermission` \| .+ \| `"admin"` \|/m);
      expect(docs).toContain('#### `notes.releaseNotes.links`');
      expect(docs).toMatch(/^\| `fromPRBodyMarker` \| string \|/m);
      expect(docs).toContain('#### `notes.releaseNotes.firstRelease`');
      expect(docs).toContain('#### `notes.releaseNotes.llm.context`');
      expect(docs).toMatch(/^\| `pullRequests` \| boolean \| `true` \|/m);
      expect(docs).toContain('##### `notes.releaseNotes.llm.prompts.instructions`');
      expect(docs).toMatch(/^\| `enhanceAndCategorize` \| string \|/m);
    });

    it('should not list a nested object as an opaque row', () => {
      expect(docs).not.toMatch(/^\| `(authorization|links|firstRelease|context|instructions)` \| object \|/m);
    });

    it('should render version.pub', () => {
      expect(docs).toContain('### `version.pub`');
      expect(docs).toMatch(/^\| `paths` \| `string\[\]` \| — \| .*pubspec\.yaml/m);
    });

    it('should render the same output on repeated calls', () => {
      expect(renderConfigDocs(schema)).toBe(docs);
    });
  });

  it('should match the committed docs/configuration.md (no drift)', () => {
    const committed = readFileSync(resolve(ROOT, 'docs', 'configuration.md'), 'utf8');
    expect(renderConfigDocs(schema)).toBe(committed);
  });
});
