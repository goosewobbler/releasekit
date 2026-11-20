import * as fs from 'node:fs';
import * as path from 'node:path';

export interface RegistryAttempt {
  spec: string;
  outcome: 'published' | 'failed' | 'conflict';
}

export interface RegistryState {
  published: string[];
  attempts: RegistryAttempt[];
  /** Publishes left to succeed before the next one fails; null never fails. */
  failAfter: number | null;
  /** The commit each published version was built from. */
  builtAt: Record<string, string>;
}

// Answers the dispatcher's `view`, `publish` and `--version` calls the way npm does, from a JSON file.
const SHIM = `#!/usr/bin/env node
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const file = process.env.RK_FAKE_REGISTRY;
const load = () => JSON.parse(fs.readFileSync(file, 'utf-8'));
const save = (state) => fs.writeFileSync(file, JSON.stringify(state, null, 2));
const [command, ...args] = process.argv.slice(2);
if (command === '--version') {
  console.log('10.0.0');
} else if (command === 'view') {
  const spec = args[0];
  if (load().published.includes(spec)) {
    console.log(JSON.stringify(spec.slice(spec.lastIndexOf('@') + 1)));
  } else {
    console.error('npm error code E404\\nnpm error 404 No match found for version ' + spec);
    process.exitCode = 1;
  }
} else if (command === 'publish') {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
  const spec = pkg.name + '@' + pkg.version;
  const state = load();
  if (state.published.includes(spec)) {
    state.attempts.push({ spec, outcome: 'conflict' });
    console.error('npm error code EPUBLISHCONFLICT\\nnpm error cannot publish over the previously published versions: ' + pkg.version);
    process.exitCode = 1;
  } else if (state.failAfter === 0) {
    state.failAfter = null;
    state.attempts.push({ spec, outcome: 'failed' });
    console.error('npm error code E403\\nnpm error 403 Forbidden - PUT ' + spec);
    process.exitCode = 1;
  } else {
    if (state.failAfter !== null) state.failAfter -= 1;
    state.published.push(spec);
    state.attempts.push({ spec, outcome: 'published' });
    state.builtAt[spec] = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
    console.log('+ ' + spec);
  }
  save(state);
} else {
  console.error('fake registry: unsupported command ' + command);
  process.exitCode = 1;
}
`;

/** `npm` and `pnpm` shims on PATH, backed by `file`. */
export class FakeRegistry {
  constructor(
    readonly file: string,
    readonly binDir: string,
  ) {}

  static create(dir: string, published: string[]): FakeRegistry {
    const binDir = path.join(dir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    for (const name of ['npm', 'pnpm']) {
      fs.writeFileSync(path.join(binDir, name), SHIM, { mode: 0o755 });
    }
    const registry = new FakeRegistry(path.join(dir, 'registry.json'), binDir);
    registry.write({ published, attempts: [], failAfter: null, builtAt: {} });
    return registry;
  }

  read(): RegistryState {
    return JSON.parse(fs.readFileSync(this.file, 'utf-8')) as RegistryState;
  }

  write(state: RegistryState): void {
    fs.writeFileSync(this.file, JSON.stringify(state, null, 2));
  }

  failAfter(count: number | null): void {
    this.write({ ...this.read(), failAfter: count });
  }
}
