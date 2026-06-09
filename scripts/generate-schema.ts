#!/usr/bin/env tsx
/**
 * Generates releasekit.schema.json from the Zod schema (single source of truth).
 *
 * Pipeline:
 *   packages/config/src/schema.ts  (Zod, with .describe() on every field)
 *     → z.toJSONSchema()           (JSON Schema draft-7)
 *     → post-processing            (this file)
 *     → releasekit.schema.json     (consumed by editors + ajv + docs:config)
 *
 * Usage:
 *   pnpm schema:gen     write releasekit.schema.json
 *   pnpm schema:check   verify the committed file matches (exits non-zero on drift)
 *
 * Never hand-edit releasekit.schema.json — edit the Zod schema and regenerate.
 *
 * Why native z.toJSONSchema (zod v4) rather than zod-to-json-schema:
 *   the repo is on zod v4, and zod-to-json-schema only reads zod v3 internals
 *   (it emits an empty schema against the v4 definitions). zod v4 ships a native
 *   JSON Schema exporter that reads the v4 schema directly. We post-process its
 *   output so the result stays drop-in compatible with the existing editor
 *   ($schema URL), ajv (draft-7, strict=false), and docs:config consumers.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ReleaseKitConfigSchema } from '../packages/config/src/schema.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const SCHEMA_PATH = resolve(ROOT, 'releasekit.schema.json');

// Top-level metadata kept identical to the consumers' expectations (editor
// $schema URL, $id, human title, description). Set here explicitly — zod's
// root .describe() is not reliably carried to the document root by the exporter.
const META = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://goosewobbler.github.io/releasekit/schema.json',
  title: 'ReleaseKit Configuration',
  description: 'Configuration schema for ReleaseKit - Automated versioning, changelog generation, and publishing',
} as const;

// The JS safe-integer ceiling zod attaches to every `.int()`. It carries no
// real constraint for config values, so we drop it (the hand-maintained schema
// never had it).
const INT_SENTINEL_MAX = 9007199254740991;

type JsonSchema = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Recursively normalise zod's draft-7 output into the shape the rest of the
 * toolchain expects:
 *   - anyOf → oneOf (the config unions are mutually exclusive; the docs
 *     generator and the original schema both use oneOf)
 *   - const X → enum [X] (boolean-false literals and the 'auto' literal; the
 *     docs generator reads `enum`, not `const`)
 *   - exclusiveMinimum: 0 → minimum: 1 (positive ints/numbers; matches the
 *     reviewed hand-maintained schema)
 *   - strip the int safe-integer sentinel maximum
 *   - additionalProperties: false on every object literal (preserves the
 *     editor/ajv strictness of the hand-maintained schema WITHOUT making the
 *     Zod parser strict — load.ts still strips unknown keys leniently)
 */
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
      out.oneOf = normalise(value);
      continue;
    }
    if (key === 'const') {
      // const → single-value enum; preserve the existing type alongside it.
      out.enum = [value];
      continue;
    }
    if (key === 'maximum' && value === INT_SENTINEL_MAX) {
      continue;
    }
    if (key === 'minimum' && value === -INT_SENTINEL_MAX) {
      // zod's lower safe-integer sentinel for unbounded `.int()` — drop it.
      continue;
    }
    if (key === 'exclusiveMinimum' && value === 0) {
      out.minimum = 1;
      continue;
    }
    out[key] = normalise(value);
  }

  // Drop `default` on object schemas. zod attaches the full default object of
  // every defaulted container (publish.npm, ci.labels, verify, …); the
  // hand-maintained schema never carried these and they bloat both the file and
  // the generated docs. Scalar and array defaults on leaf fields are kept —
  // they are the documented, user-facing defaults.
  if (out.type === 'object' && 'default' in out) {
    delete out.default;
  }

  // Drop verbose prose defaults (e.g. the LLM writing-style guidance). These
  // read poorly in the generated docs' per-field default column and are
  // documented in prose elsewhere; the short, enumerable defaults stay.
  if (typeof out.default === 'string' && out.default.length > 80) {
    delete out.default;
  }

  // Add additionalProperties: false to object literals that declare their own
  // properties and don't already constrain additionalProperties (record/map
  // schemas such as version.groups and ci.scopeLabels keep their schema-valued
  // additionalProperties untouched).
  if (out.type === 'object' && 'properties' in out && !('additionalProperties' in out)) {
    out.additionalProperties = false;
  }

  return out;
}

// Stable, readable keyword ordering matching the hand-maintained schema's
// convention. Applied only to JSON Schema *keyword* keys of a schema node —
// never to the field-name keys inside `properties` (definition order is
// meaningful there) nor to raw `default` data.
const KEY_ORDER = [
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
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

/**
 * Reorder the keyword keys of a JSON Schema node for readable, stable output.
 * Recurses through schema-bearing positions (`properties` values, `items`,
 * `oneOf`/`anyOf` members, schema-valued `additionalProperties`) but preserves
 * the insertion order of property names and never rewrites `default`/`enum`
 * data values.
 */
function orderSchemaNode(node: unknown): unknown {
  if (!isPlainObject(node)) {
    return node;
  }
  const out: JsonSchema = {};
  for (const key of orderedKeywordKeys(Object.keys(node))) {
    const value = node[key];
    if (key === 'properties' && isPlainObject(value)) {
      // Preserve field-name (definition) order; order each field's schema node.
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
      // Record/map value schema (e.g. version.groups, ci.scopeLabels).
      out[key] = orderSchemaNode(value);
    } else {
      // type, enum, default, description, required, etc. — leave data as-is.
      out[key] = value;
    }
  }
  return out;
}

export function buildSchema(): JsonSchema {
  const raw = z.toJSONSchema(ReleaseKitConfigSchema, { target: 'draft-7', io: 'input' }) as JsonSchema;

  // zod emits its own $schema plus the body (description/type/properties/...);
  // drop it and prepend our canonical metadata ($schema/$id/title).
  const { $schema: _drop, ...body } = raw;
  const normalisedBody = normalise(body) as JsonSchema;

  const assembled: JsonSchema = {
    ...META,
    ...normalisedBody,
  };

  return orderSchemaNode(assembled) as JsonSchema;
}

export function serialiseSchema(): string {
  // 2-space indent + trailing newline to match biome's JSON formatting.
  return `${JSON.stringify(buildSchema(), null, 2)}\n`;
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
      // Show what changed so the failure is actionable in CI logs.
      try {
        execFileSync('git', ['--no-pager', 'diff', '--no-color', SCHEMA_PATH], { cwd: ROOT, stdio: 'inherit' });
      } catch {
        // git unavailable or file untracked — the message above is enough.
      }
      process.exit(1);
    }
    console.log('releasekit.schema.json is up to date.');
    return;
  }

  writeFileSync(SCHEMA_PATH, generated, 'utf8');
  console.log(`Generated: ${SCHEMA_PATH}`);
}

// Run only when invoked directly — importing this module (e.g. from the
// generator's unit test) must not write the schema file as a side effect.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
