#!/usr/bin/env tsx
/**
 * Uses zod v4's native z.toJSONSchema: zod-to-json-schema only reads zod v3
 * internals and emits an empty schema for v4. The output is post-processed to
 * stay compatible with its consumers: editors ($schema URL), ajv (draft-7,
 * strict=false) and docs:config.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ReleaseKitConfigSchema } from '../packages/config/src/schema.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const SCHEMA_PATH = resolve(ROOT, 'releasekit.schema.json');

// Set explicitly: the exporter doesn't reliably carry zod's root .describe() to
// the document root.
const META = {
  $comment: 'GENERATED from packages/config/src/schema.ts — do not edit; run `pnpm schema:gen`.',
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://goosewobbler.github.io/releasekit/schema.json',
  title: 'ReleaseKit Configuration',
  description: 'Configuration schema for ReleaseKit - Automated versioning, changelog generation, and publishing',
} as const;

// The JS safe-integer ceiling zod attaches to every `.int()`; meaningless for
// config values, so dropped.
const INT_SENTINEL_MAX = 9007199254740991;

type JsonSchema = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalise(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(normalise);
  }
  if (!isPlainObject(node)) {
    return node;
  }

  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'anyOf') {
      // The config unions are mutually exclusive, and the docs generator reads oneOf.
      out.oneOf = normalise(value);
      continue;
    }
    if (key === 'const') {
      // The docs generator reads `enum`, not `const`.
      out.enum = [value];
      continue;
    }
    if (key === 'maximum' && value === INT_SENTINEL_MAX) {
      continue;
    }
    if (key === 'minimum' && value === -INT_SENTINEL_MAX) {
      continue;
    }
    if (key === 'exclusiveMinimum' && value === 0) {
      out.minimum = 1;
      continue;
    }
    out[key] = normalise(value);
  }

  // zod attaches each defaulted container's full default object, which bloats
  // both the file and the generated docs.
  if (out.type === 'object' && 'default' in out) {
    delete out.default;
  }

  // Long prose defaults (e.g. the LLM writing-style guidance) read poorly in the
  // generated docs' per-field default column.
  if (typeof out.default === 'string' && out.default.length > 80) {
    delete out.default;
  }

  // Editor/ajv strictness without making the Zod parser strict (load.ts strips
  // unknown keys leniently). Record/map schemas such as version.groups keep
  // their schema-valued additionalProperties.
  if (out.type === 'object' && 'properties' in out && !('additionalProperties' in out)) {
    out.additionalProperties = false;
  }

  return out;
}

const KEY_ORDER = [
  '$comment',
  '$schema',
  '$id',
  'title',
  'type',
  'enum',
  'const',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'minLength',
  'minItems',
  'default',
  'additionalProperties',
  'properties',
  'items',
  'oneOf',
  'anyOf',
  'required',
  'description',
];

function orderedKeywordKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const ia = KEY_ORDER.indexOf(a);
    const ib = KEY_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) {
      return a.localeCompare(b);
    }
    if (ia === -1) {
      return 1;
    }
    if (ib === -1) {
      return -1;
    }
    return ia - ib;
  });
}

function orderSchemaNode(node: unknown): unknown {
  if (!isPlainObject(node)) {
    return node;
  }
  const out: JsonSchema = {};
  for (const key of orderedKeywordKeys(Object.keys(node))) {
    const value = node[key];
    if (key === 'properties' && isPlainObject(value)) {
      // Definition order is meaningful; only each field's schema is reordered.
      const props: JsonSchema = {};
      for (const field of Object.keys(value)) {
        props[field] = orderSchemaNode(value[field]);
      }
      out[key] = props;
    } else if (key === 'items') {
      out[key] = Array.isArray(value) ? value.map(orderSchemaNode) : orderSchemaNode(value);
    } else if (key === 'oneOf' || key === 'anyOf' || key === 'allOf') {
      out[key] = Array.isArray(value) ? value.map(orderSchemaNode) : value;
    } else if (key === 'additionalProperties' && isPlainObject(value)) {
      out[key] = orderSchemaNode(value);
    } else {
      // Data values (enum, default, ...) are left as-is.
      out[key] = value;
    }
  }
  return out;
}

export function buildSchema(): JsonSchema {
  const raw = z.toJSONSchema(ReleaseKitConfigSchema, { target: 'draft-7', io: 'input' }) as JsonSchema;

  const { $schema: _drop, ...body } = raw;
  const normalisedBody = normalise(body) as JsonSchema;

  const assembled: JsonSchema = {
    ...META,
    ...normalisedBody,
  };

  return orderSchemaNode(assembled) as JsonSchema;
}

export function serialiseSchema(): string {
  // Matches biome's JSON formatting.
  return `${JSON.stringify(buildSchema(), null, 2)}\n`;
}

/**
 * `git diff` shows nothing in CI's clean checkout (the file on disk was never
 * regenerated), so diff the committed and generated strings directly.
 */
function printUnifiedDiff(before: string, after: string, label: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'schema-check-'));
  const beforePath = join(dir, 'before.json');
  const afterPath = join(dir, 'after.json');
  try {
    writeFileSync(beforePath, before);
    writeFileSync(afterPath, after);
    const result = spawnSync(
      'diff',
      ['-u', `--label=${label} (committed)`, `--label=${label} (generated)`, beforePath, afterPath],
      { encoding: 'utf8' },
    );
    if (result.stdout) {
      process.stderr.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    if (result.status === 127 || result.error) {
      // `diff` not on PATH (e.g. Windows).
      printLineDiffFallback(before, after, label);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function printLineDiffFallback(before: string, after: string, label: string): void {
  process.stderr.write(`--- ${label} (committed)\n+++ ${label} (generated)\n`);
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  for (let i = 0; i < Math.max(beforeLines.length, afterLines.length); i++) {
    if (beforeLines[i] !== afterLines[i]) {
      if (beforeLines[i] !== undefined) {
        process.stderr.write(`- ${beforeLines[i]}\n`);
      }
      if (afterLines[i] !== undefined) {
        process.stderr.write(`+ ${afterLines[i]}\n`);
      }
    }
  }
}

function main(): void {
  const checkMode = process.argv.includes('--check');
  const generated = serialiseSchema();

  if (checkMode) {
    let current: string;
    try {
      current = readFileSync(SCHEMA_PATH, 'utf8');
    } catch {
      current = '';
    }
    if (current !== generated) {
      console.error(
        'releasekit.schema.json is out of date with the Zod schema.\n' + 'Run `pnpm schema:gen` and commit the result.',
      );
      printUnifiedDiff(current, generated, SCHEMA_PATH);
      process.exit(1);
    }
    console.log('releasekit.schema.json is up to date.');
    return;
  }

  writeFileSync(SCHEMA_PATH, generated, 'utf8');
  console.log(`Generated: ${SCHEMA_PATH}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
