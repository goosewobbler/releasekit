// Schema drift silently breaks editor autocompletion and the examples-validate
// ajv workflow.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSchema, serialiseSchema } from '../../../../scripts/generate-schema.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('generate-schema', () => {
  describe('buildSchema()', () => {
    it('should emit draft-07 metadata at the top level', () => {
      const schema = buildSchema() as Record<string, unknown>;
      expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
      expect(schema.$id).toBe('https://goosewobbler.github.io/releasekit/schema.json');
      expect(schema.title).toBe('ReleaseKit Configuration');
      expect(typeof schema.description).toBe('string');
      expect((schema.description as string).length).toBeGreaterThan(0);
    });

    it('should declare additionalProperties on every object node (no silent leniency)', () => {
      const schema = buildSchema();
      const stack: unknown[] = [schema];
      // Collected rather than asserted inline: vitest/no-conditional-expect flags
      // `expect` inside an `if`, and this surfaces every violation, not just the first.
      const violations: string[] = [];
      let objectsChecked = 0;
      while (stack.length > 0) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') {
          continue;
        }
        const obj = node as Record<string, unknown>;
        if (obj.type === 'object') {
          objectsChecked++;
          // Allowed: `false` (closed object) or an object schema (z.record value type).
          if (obj.additionalProperties === undefined) {
            violations.push(
              `object node missing additionalProperties: ${JSON.stringify(obj.properties ? Object.keys(obj.properties) : obj)}`,
            );
          } else if (obj.additionalProperties === true) {
            violations.push('object node has additionalProperties: true (silent leniency)');
          }
        }
        for (const value of Object.values(obj)) {
          stack.push(value);
        }
      }
      expect(violations).toEqual([]);
      expect(objectsChecked).toBeGreaterThan(10);
    });

    it('should carry Zod .describe() text through to field descriptions', () => {
      const schema = buildSchema() as {
        properties?: Record<string, { properties?: Record<string, { description?: string }> }>;
      };
      const scopeLabels = schema.properties?.ci?.properties?.scopeLabels;
      expect(scopeLabels?.description).toBeDefined();
      expect((scopeLabels?.description ?? '').length).toBeGreaterThan(0);
    });
  });

  describe('serialiseSchema()', () => {
    it('should match the committed releasekit.schema.json (no drift)', () => {
      const committed = readFileSync(resolve(ROOT, 'releasekit.schema.json'), 'utf8');
      expect(serialiseSchema()).toBe(committed);
    });
  });
});
