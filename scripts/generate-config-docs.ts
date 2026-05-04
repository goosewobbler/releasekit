#!/usr/bin/env tsx
/**
 * Generates docs/configuration.md from releasekit.schema.json.
 * Usage: pnpm docs:config
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const SCHEMA_PATH = resolve(ROOT, 'releasekit.schema.json');
const OUT_PATH = resolve(ROOT, 'docs', 'configuration.md');

interface SchemaProperty {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  items?: SchemaProperty & { properties?: Record<string, SchemaProperty>; required?: string[] };
  properties?: Record<string, SchemaProperty>;
  oneOf?: SchemaProperty[];
  additionalProperties?: boolean | SchemaProperty;
  required?: string[];
  minimum?: number;
  minItems?: number;
}

interface Schema {
  properties: Record<string, SchemaProperty>;
}

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as Schema;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensurePeriod(str: string | undefined): string {
  if (!str) return '';
  const s = str.trim();
  return s.endsWith('.') ? s : `${s}.`;
}

function fmtDefault(val: unknown): string {
  if (val === undefined || val === null) return '—';
  if (typeof val === 'boolean') return String(val);
  if (typeof val === 'string') return `\`"${val}"\``;
  if (Array.isArray(val)) {
    if (val.length === 0) return '`[]`';
    return `\`${JSON.stringify(val)}\``;
  }
  if (typeof val === 'number') return String(val);
  return `\`${JSON.stringify(val)}\``;
}

function fmtType(prop: SchemaProperty): string {
  if (prop.enum && prop.type === 'string') {
    return prop.enum.map((v) => `\`"${v}"\``).join(' | ');
  }
  if (prop.oneOf) {
    return prop.oneOf
      .map((s) => {
        if (s.type === 'boolean') return 'boolean';
        if (s.type === 'string' && s.enum) return s.enum.map((v) => `\`"${v}"\``).join(' | ');
        return s.type ?? 'any';
      })
      .join(' | ');
  }
  if (prop.type === 'array') {
    const itemType = prop.items?.type ?? 'any';
    return `\`${itemType}[]\``;
  }
  if (prop.type === 'object') return 'object';
  if (prop.type === 'integer') return 'integer';
  if (prop.type === 'number') return 'number';
  return prop.type ?? '—';
}

function escapePipes(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

function propsTable(properties: Record<string, SchemaProperty>): string {
  if (!properties || Object.keys(properties).length === 0) return '';
  const rows = Object.entries(properties).map(([key, prop]) => {
    const type = escapePipes(fmtType(prop));
    const def = fmtDefault(prop.default);
    const desc = escapePipes((prop.description ?? '').replace(/\n/g, ' '));
    return `| \`${key}\` | ${type} | ${def} | ${desc} |`;
  });
  return ['| Key | Type | Default | Description |', '|-----|------|---------|-------------|', ...rows].join('\n');
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

const lines: string[] = [];

function emit(...strs: string[]): void {
  lines.push(...strs);
}

function emitBlank(): void {
  lines.push('');
}

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------
function renderGit(prop: SchemaProperty): void {
  emit('## `git`', '');
  emit(ensurePeriod(prop.description), '');
  emit(propsTable(prop.properties ?? {}));
  emitBlank();
}

// ---------------------------------------------------------------------------
// monorepo
// ---------------------------------------------------------------------------
function renderMonorepo(prop: SchemaProperty): void {
  emit('## `monorepo`', '');
  emit(ensurePeriod(prop.description), '');
  emit(propsTable(prop.properties ?? {}));
  emitBlank();
}

// ---------------------------------------------------------------------------
// version
// ---------------------------------------------------------------------------
function renderVersion(prop: SchemaProperty): void {
  emit('## `version`', '');
  emit(ensurePeriod(prop.description), '');

  const topProps = Object.fromEntries(
    Object.entries(prop.properties ?? {}).filter(([k]) => k !== 'cargo' && k !== 'branchPatterns'),
  );
  emit(propsTable(topProps));
  emitBlank();

  const bp = prop.properties?.branchPatterns;
  if (bp?.items?.properties) {
    emit(`**\`version.branchPatterns\`** — ${ensurePeriod(bp.description)}`, '');
    emit('Array of objects with the following properties:', '');
    emit(propsTable(bp.items.properties));
    emitBlank();
  }

  const cargo = prop.properties?.cargo;
  if (cargo) {
    emit('### `version.cargo`', '');
    emit(ensurePeriod(cargo.description), '');
    emit(propsTable(cargo.properties ?? {}));
    emitBlank();
  }
}

// ---------------------------------------------------------------------------
// publish
// ---------------------------------------------------------------------------
function renderPublish(prop: SchemaProperty): void {
  emit('## `publish`', '');
  emit(ensurePeriod(prop.description), '');
  emitBlank();

  const git = prop.properties?.git;
  if (git) {
    emit('### `publish.git`', '');
    emit(ensurePeriod(git.description), '');
    emit(propsTable(git.properties ?? {}));
    emitBlank();
  }

  const npm = prop.properties?.npm;
  if (npm) {
    emit('### `publish.npm`', '');
    emit(ensurePeriod(npm.description), '');
    emit(propsTable(npm.properties ?? {}));
    emitBlank();
  }

  const cargo = prop.properties?.cargo;
  if (cargo) {
    emit('### `publish.cargo`', '');
    emit(ensurePeriod(cargo.description), '');
    emit(propsTable(cargo.properties ?? {}));
    emitBlank();
  }

  const gh = prop.properties?.githubRelease;
  if (gh) {
    emit('### `publish.githubRelease`', '');
    emit(ensurePeriod(gh.description), '');
    emit(propsTable(gh.properties ?? {}));
    emitBlank();
  }

  const verify = prop.properties?.verify;
  if (verify) {
    emit('### `publish.verify`', '');
    emit(ensurePeriod(verify.description), '');
    emitBlank();

    const verifyNpm = verify.properties?.npm;
    if (verifyNpm) {
      emit('#### `publish.verify.npm`', '');
      emit(propsTable(verifyNpm.properties ?? {}));
      emitBlank();
    }

    const verifyCargo = verify.properties?.cargo;
    if (verifyCargo) {
      emit('#### `publish.verify.cargo`', '');
      emit(propsTable(verifyCargo.properties ?? {}));
      emitBlank();
    }
  }
}

// ---------------------------------------------------------------------------
// notes
// ---------------------------------------------------------------------------
function renderOneOfBooleanObject(key: string, schemaProp: SchemaProperty): void {
  const objSchema = schemaProp.oneOf?.find((s) => s.type === 'object');
  if (!objSchema) return;

  emit('Set to `false` to disable.', '');

  const topProps = Object.fromEntries(
    Object.entries(objSchema.properties ?? {}).filter(([k]) => k !== 'templates' && k !== 'llm'),
  );
  if (Object.keys(topProps).length > 0) {
    emit(propsTable(topProps));
    emitBlank();
  }

  const tpl = objSchema.properties?.templates;
  if (tpl) {
    emit(`**\`${key}.templates\`** — ${ensurePeriod(tpl.description)}`, '');
    emit(propsTable(tpl.properties ?? {}));
    emitBlank();
  }
}

function renderLlm(llm: SchemaProperty): void {
  emit('### `notes.releaseNotes.llm`', '');
  emit(ensurePeriod(llm.description), '');
  emitBlank();

  const skip = new Set(['options', 'tasks', 'categories', 'scopes', 'retry', 'prompts']);
  const topProps = Object.fromEntries(Object.entries(llm.properties ?? {}).filter(([k]) => !skip.has(k)));
  emit(propsTable(topProps));
  emitBlank();

  const options = llm.properties?.options;
  if (options) {
    emit('#### `notes.releaseNotes.llm.options`', '');
    emit(propsTable(options.properties ?? {}));
    emitBlank();
  }

  const tasks = llm.properties?.tasks;
  if (tasks) {
    emit('#### `notes.releaseNotes.llm.tasks`', '');
    emit('Enable or disable individual LLM processing tasks.', '');
    emit(propsTable(tasks.properties ?? {}));
    emitBlank();
  }

  const categories = llm.properties?.categories;
  if (categories?.items?.properties) {
    emit('#### `notes.releaseNotes.llm.categories`', '');
    emit('Array of category objects used for commit categorization. Each item has:', '');
    emit(propsTable(categories.items.properties));
    emitBlank();
  }

  const scopes = llm.properties?.scopes;
  if (scopes) {
    emit('#### `notes.releaseNotes.llm.scopes`', '');
    emit('Scope validation configuration.', '');
    const scopesTopProps = Object.fromEntries(Object.entries(scopes.properties ?? {}).filter(([k]) => k !== 'rules'));
    emit(propsTable(scopesTopProps));
    emitBlank();

    const rules = scopes.properties?.rules;
    if (rules) {
      emit('**`notes.releaseNotes.llm.scopes.rules`**', '');
      emit(propsTable(rules.properties ?? {}));
      emitBlank();
    }
  }

  const retry = llm.properties?.retry;
  if (retry) {
    emit('#### `notes.releaseNotes.llm.retry`', '');
    emit('Retry behaviour for failed LLM requests.', '');
    emit(propsTable(retry.properties ?? {}));
    emitBlank();
  }

  const prompts = llm.properties?.prompts;
  if (prompts) {
    emit('#### `notes.releaseNotes.llm.prompts`', '');
    emit('Override built-in prompt instructions per task.', '');
    emit(propsTable(prompts.properties ?? {}));
    emitBlank();
  }
}

function renderNotes(prop: SchemaProperty): void {
  emit('## `notes`', '');
  emit(ensurePeriod(prop.description), '');
  emitBlank();

  const topProps = Object.fromEntries(
    Object.entries(prop.properties ?? {}).filter(([k]) => k !== 'changelog' && k !== 'releaseNotes'),
  );
  if (Object.keys(topProps).length > 0) {
    emit(propsTable(topProps));
    emitBlank();
  }

  const changelog = prop.properties?.changelog;
  if (changelog) {
    emit('### `notes.changelog`', '');
    renderOneOfBooleanObject('notes.changelog', changelog);
  }

  const releaseNotes = prop.properties?.releaseNotes;
  if (releaseNotes) {
    emit('### `notes.releaseNotes`', '');
    renderOneOfBooleanObject('notes.releaseNotes', releaseNotes);

    const rnObj = releaseNotes.oneOf?.find((s) => s.type === 'object');
    if (rnObj?.properties?.llm) {
      renderLlm(rnObj.properties.llm);
    }
  }
}

// ---------------------------------------------------------------------------
// ci
// ---------------------------------------------------------------------------
function renderCi(prop: SchemaProperty): void {
  emit('## `ci`', '');
  emit(ensurePeriod(prop.description), '');
  emitBlank();

  const topProps = Object.fromEntries(
    Object.entries(prop.properties ?? {}).filter(([k]) => k !== 'labels' && k !== 'standingPr'),
  );
  emit(propsTable(topProps));
  emitBlank();

  const labels = prop.properties?.labels;
  if (labels) {
    emit('### `ci.labels`', '');
    emit(ensurePeriod(labels.description), '');
    emit(propsTable(labels.properties ?? {}));
    emitBlank();
  }

  const standingPr = prop.properties?.standingPr;
  if (standingPr) {
    emit('### `ci.standingPr`', '');
    emit(ensurePeriod(standingPr.description), '');
    emit(propsTable(standingPr.properties ?? {}));
    emitBlank();
  }
}

// ---------------------------------------------------------------------------
// release
// ---------------------------------------------------------------------------
function renderRelease(prop: SchemaProperty): void {
  emit('## `release`', '');
  emit(ensurePeriod(prop.description), '');
  emitBlank();

  const steps = prop.properties?.steps;
  if (steps) {
    const stepsEnum = steps.items?.enum ?? [];
    const stepsDesc = ensurePeriod(escapePipes(steps.description ?? ''));
    emit(
      '| Key | Type | Default | Description |',
      '|-----|------|---------|-------------|',
      `| \`steps\` | \`string[]\` | — | ${stepsDesc} Allowed values: ${stepsEnum.map((v) => `\`"${v}"\``).join(', ')}. |`,
    );
    emitBlank();
  }

  const ci = prop.properties?.ci;
  if (ci) {
    emit('### `release.ci`', '');
    emit(ensurePeriod(ci.description), '');
    emit(propsTable(ci.properties ?? {}));
    emitBlank();
  }
}

// ---------------------------------------------------------------------------
// Compose document
// ---------------------------------------------------------------------------

emit(
  '<!-- AUTO-GENERATED FROM releasekit.schema.json — DO NOT EDIT DIRECTLY -->',
  '<!-- Run `pnpm docs:config` to regenerate -->',
  '',
  '# Configuration Reference',
  '',
  'ReleaseKit is configured via a `releasekit.config.json` file in the root of your repository. Add a `$schema` reference for editor autocompletion:',
  '',
  '```json',
  '{',
  '  "$schema": "https://goosewobbler.github.io/releasekit/schema.json"',
  '}',
  '```',
  '',
  '---',
  '',
);

const props = schema.properties;

renderGit(props.git);
emit('---', '');
renderMonorepo(props.monorepo);
emit('---', '');
renderVersion(props.version);
emit('---', '');
renderPublish(props.publish);
emit('---', '');
renderNotes(props.notes);
emit('---', '');
renderCi(props.ci);
emit('---', '');
renderRelease(props.release);
emit('---', '');

emit(
  'For the canonical machine-readable schema, see [releasekit.schema.json](https://goosewobbler.github.io/releasekit/schema.json).',
);

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${lines.join('\n')}\n`, 'utf8');
console.log(`Generated: ${OUT_PATH}`);
