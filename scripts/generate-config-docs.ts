#!/usr/bin/env tsx

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

export interface Schema {
  properties: Record<string, SchemaProperty>;
}

function ensurePeriod(str: string | undefined): string {
  if (!str) {
    return '';
  }
  const s = str.trim();
  return s.endsWith('.') ? s : `${s}.`;
}

function fmtDefault(val: unknown): string {
  if (val === undefined || val === null) {
    return '—';
  }
  if (typeof val === 'boolean') {
    return `\`${val}\``;
  }
  if (typeof val === 'string') {
    return `\`"${val}"\``;
  }
  if (Array.isArray(val)) {
    if (val.length === 0) {
      return '`[]`';
    }
    return `\`${JSON.stringify(val)}\``;
  }
  if (typeof val === 'number') {
    return `\`${val}\``;
  }
  return `\`${JSON.stringify(val)}\``;
}

function fmtType(prop: SchemaProperty): string {
  if (prop.enum && prop.type === 'string') {
    return prop.enum.map((v) => `\`"${v}"\``).join(' | ');
  }
  if (prop.oneOf) {
    return prop.oneOf
      .map((s) => {
        if (s.type === 'boolean' && s.enum) {
          return (s.enum as unknown[]).map((v) => `\`${v}\``).join(' | ');
        }
        if (s.type === 'boolean') {
          return 'boolean';
        }
        if (s.type === 'string' && s.enum) {
          return s.enum.map((v) => `\`"${v}"\``).join(' | ');
        }
        return s.type ?? 'any';
      })
      .join(' | ');
  }
  if (prop.type === 'array') {
    const itemType = prop.items?.type ?? 'any';
    return `\`${itemType}[]\``;
  }
  if (prop.type === 'object') {
    return 'object';
  }
  if (prop.type === 'integer') {
    return 'integer';
  }
  if (prop.type === 'number') {
    return 'number';
  }
  return prop.type ?? '—';
}

function escapePipes(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

function propsTable(properties: Record<string, SchemaProperty>): string {
  if (!properties || Object.keys(properties).length === 0) {
    return '';
  }
  const rows = Object.entries(properties).map(([key, prop]) => {
    const type = escapePipes(fmtType(prop));
    const def = fmtDefault(prop.default);
    const desc = escapePipes((prop.description ?? '').replace(/\n/g, ' '));
    return `| \`${key}\` | ${type} | ${def} | ${desc} |`;
  });
  return ['| Key | Type | Default | Description |', '|-----|------|---------|-------------|', ...rows].join('\n');
}

const lines: string[] = [];

function emit(...strs: string[]): void {
  lines.push(...strs);
}

function emitBlank(): void {
  lines.push('');
}

function objectSchema(prop: SchemaProperty): SchemaProperty | undefined {
  if (prop.type === 'object' && prop.properties) {
    return prop;
  }
  return prop.oneOf?.find((s) => s.type === 'object' && s.properties);
}

/** Scalar keys go in one table; each object-valued key gets its own section rather than an opaque `object` row. */
function renderProps(path: string, properties: Record<string, SchemaProperty>, level: number): void {
  const scalars = Object.fromEntries(Object.entries(properties).filter(([, p]) => !objectSchema(p)));
  if (Object.keys(scalars).length > 0) {
    emit(propsTable(scalars));
    emitBlank();
  }
  for (const [key, prop] of Object.entries(properties)) {
    const obj = objectSchema(prop);
    if (!obj) {
      continue;
    }
    emit(`${'#'.repeat(level)} \`${path}.${key}\``, '');
    if (prop.description) {
      emit(ensurePeriod(prop.description), '');
    }
    renderProps(`${path}.${key}`, obj.properties ?? {}, Math.min(level + 1, 6));
  }
}

function renderGit(prop: SchemaProperty): void {
  emit('## `git`', '');
  emit(ensurePeriod(prop.description), '');
  emit(propsTable(prop.properties ?? {}));
  emitBlank();
}

function renderMonorepo(prop: SchemaProperty): void {
  emit('## `monorepo`', '');
  emit(ensurePeriod(prop.description), '');
  emit(propsTable(prop.properties ?? {}));
  emitBlank();
}

function renderVersion(prop: SchemaProperty): void {
  emit('## `version`', '');
  emit(ensurePeriod(prop.description), '');

  const topProps = Object.fromEntries(
    Object.entries(prop.properties ?? {}).filter(([k]) => k !== 'cargo' && k !== 'groups'),
  );
  emit(propsTable(topProps));
  emitBlank();

  emit('### `version.zeroMajor`', '');
  emit(
    'How a **commit-inferred** breaking change (`feat!:` / `BREAKING CHANGE:`) bumps a pre-1.0 version (current major `0`):',
    '',
  );
  emit(
    '- `"spec"` (default): bumps the 0.x minor — `0.24.0` → `0.25.0`. Per [semver §4](https://semver.org/#spec-item-4); also matches npm caret (`^0.24.0` excludes `0.25.0`), Cargo, and changesets.',
    '- `"strict"`: bumps the next major — `0.24.0` → `1.0.0` (the semantic-release convention).',
    '',
  );
  emit(
    'Inferred path only. Explicit overrides (`--bump major`, `bump:major` on the standing PR, `release:immediate` + `bump:major` on a feeder PR) always graduate to `1.0.0` — cutting 1.0 stays a deliberate act.',
    '',
  );

  const groups = prop.properties?.groups;
  const groupItem = typeof groups?.additionalProperties === 'object' ? groups.additionalProperties : undefined;
  if (groups) {
    emit('### `version.groups`', '');
    emit(
      'Named version groups let a co-evolving family of packages version together while the rest',
      'of the monorepo versions independently. Groups are one of three release-coordination',
      'mechanisms — see the [release taxonomy](./release-taxonomy.md) for groups vs. derived',
      'prerequisites vs. selection. Each entry under `groups` is a group name mapping to',
      '`{ packages, sync }`, where `packages` is a list of patterns (same matching as',
      '`version.packages`) and `sync` is one of:',
      '',
    );
    if (groupItem?.properties) {
      emit(propsTable(groupItem.properties));
    }
    emitBlank();
    emit(
      '- **`fixed`** — any releasable change in *any* member releases **all** members at the shared',
      '  group version, computed as `bump(max(member baselines))`. This is the changesets `fixed`',
      '  semantics. The global `version.sync: true` flag is exactly this, applied to one implicit',
      '  group of every package — there is one mechanism, not two.',
      '- **`linked`** — only members with a releasable change release, but every releasing member',
      '  shares the same computed version. Unchanged members are left untouched (no empty re-release).',
      '- **`independent`** — only members with a releasable change release, each on its **own**',
      '  commit-driven version line (no shared group version). The set is still atomic: targeting any',
      '  member pulls in the whole group, and dropping a changed member (via `config.skip`) warns. Use',
      '  this for packages coupled by a contract but versioned separately (e.g. a wire protocol across',
      '  an npm package and a Rust crate on different version lines).',
      '',
    );
    emit(
      '**Group baseline** is the highest member version found in tags / manifests; the group bumps',
      'from there.',
      '',
    );
    emit(
      '> **Member adoption.** A member below the group baseline — never released, or at an older version',
      '> than the family — adopts the group version on its next release (joining a family at `2.3.0`',
      '> releases at `2.4.0`, skipping its own `1.x` line), overriding the per-package "initial version',
      '> from `package.json`" rule. The version step warns when the jump skips versions.',
      '',
    );
    emit(
      '**`--target` and atomic groups.** Targeting a strict subset of an atomic group (`fixed` or',
      '`independent`) expands to the whole group, so it never silently splits. `linked` groups and',
      'ungrouped packages honor targets as-is.',
      '',
    );
    emit(
      '**Workspace pins.** Intra-group `workspace:*` dependencies resolve to the group version within a',
      'run, so a fixed group publishes internally consistent.',
      '',
    );
  }

  const npm = prop.properties?.npm;
  if (npm) {
    emit('### `version.npm`', '');
    emit(ensurePeriod(npm.description), '');
    emit(propsTable(npm.properties ?? {}));
    emitBlank();
  }

  const cargo = prop.properties?.cargo;
  if (cargo) {
    emit('### `version.cargo`', '');
    emit(ensurePeriod(cargo.description), '');
    emit(propsTable(cargo.properties ?? {}));
    emitBlank();
  }

  const pub = prop.properties?.pub;
  if (pub) {
    emit('### `version.pub`', '');
    emit(ensurePeriod(pub.description), '');
    emit(propsTable(pub.properties ?? {}));
    emitBlank();
  }
}

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

  const pub = prop.properties?.pub;
  if (pub) {
    emit('### `publish.pub`', '');
    emit(ensurePeriod(pub.description), '');
    emit(propsTable(pub.properties ?? {}));
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

    const verifyPub = verify.properties?.pub;
    if (verifyPub) {
      emit('#### `publish.verify.pub`', '');
      emit(propsTable(verifyPub.properties ?? {}));
      emitBlank();
    }
  }
}

function renderOneOfBooleanObject(key: string, schemaProp: SchemaProperty): void {
  const objSchema = schemaProp.oneOf?.find((s) => s.type === 'object');
  if (!objSchema) {
    return;
  }

  if (schemaProp.description) {
    emit(ensurePeriod(schemaProp.description), '');
  }

  const props = Object.fromEntries(Object.entries(objSchema.properties ?? {}).filter(([k]) => k !== 'llm'));
  renderProps(key, props, 4);
}

function renderLlm(llm: SchemaProperty): void {
  emit('### `notes.releaseNotes.llm`', '');
  emit(ensurePeriod(llm.description), '');

  const { categories, ...props } = llm.properties ?? {};
  renderProps('notes.releaseNotes.llm', props, 4);

  if (categories?.items?.properties) {
    emit('#### `notes.releaseNotes.llm.categories`', '');
    emit(`${ensurePeriod(categories.description)} Each item has:`, '');
    emit(propsTable(categories.items.properties));
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

function renderCi(prop: SchemaProperty): void {
  emit('## `ci`', '');
  emit(ensurePeriod(prop.description), '');
  emitBlank();

  const topProps = Object.fromEntries(
    Object.entries(prop.properties ?? {}).filter(([k]) => k !== 'labels' && k !== 'standingPr' && k !== 'prPreview'),
  );
  emit(propsTable(topProps));
  emitBlank();

  const prPreview = prop.properties?.prPreview;
  if (prPreview?.oneOf) {
    emit('### `ci.prPreview`', '');
    renderOneOfBooleanObject('ci.prPreview', prPreview);
  }

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
    renderProps('ci.standingPr', standingPr.properties ?? {}, 4);
  }
}

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

export function renderConfigDocs(schema: Schema): string {
  lines.length = 0;

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
    'Comments are supported. You can use `//` line comments and `/* … */` block comments, and trailing commas are allowed. To stop your editor from flagging comments as JSON errors, name the file `releasekit.config.jsonc` instead — both filenames are discovered automatically, with `.json` taking precedence when both are present.',
    '',
    '```jsonc',
    '{',
    '  // editor autocompletion + comment support',
    '  "$schema": "https://goosewobbler.github.io/releasekit/schema.json",',
    '  "publish": {',
    '    "npm": { "enabled": true } // publish to npm',
    '  }',
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

  return `${lines.join('\n')}\n`;
}

function main(): void {
  const output = renderConfigDocs(JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as Schema);

  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(OUT_PATH, 'utf8');
    } catch {
      current = '';
    }
    if (current !== output) {
      console.error(`${OUT_PATH} is out of date with the schema.\nRun \`pnpm docs:config\` and commit the result.`);
      process.exit(1);
    }
    console.log(`${OUT_PATH} is up to date.`);
  } else {
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, output, 'utf8');
    console.log(`Generated: ${OUT_PATH}`);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
