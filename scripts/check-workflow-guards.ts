#!/usr/bin/env tsx
/**
 * Workflow `if` guards can't read releasekit.config.json, so they name the standing-PR branch as a
 * literal. Fails when a `github.head_ref` comparison names any other branch than ci.standingPr.branch.
 * Usage: pnpm workflows:check
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS_DIR = join(ROOT, '.github', 'workflows');

const config = JSON.parse(readFileSync(join(ROOT, 'releasekit.config.json'), 'utf8'));
const schema = JSON.parse(readFileSync(join(ROOT, 'releasekit.schema.json'), 'utf8'));
const branch: string =
  config.ci?.standingPr?.branch ?? schema.properties.ci.properties.standingPr.properties.branch.default;

const mismatches: string[] = [];
for (const file of readdirSync(WORKFLOWS_DIR).filter((name) => /\.ya?ml$/.test(name))) {
  const lines = readFileSync(join(WORKFLOWS_DIR, file), 'utf8').split('\n');
  lines.forEach((line, index) => {
    for (const [, literal] of line.matchAll(/github\.head_ref\s*[!=]=\s*'([^']*)'/g)) {
      if (literal !== branch) {
        mismatches.push(`.github/workflows/${file}:${index + 1} compares github.head_ref with '${literal}'`);
      }
    }
  });
}

if (mismatches.length > 0) {
  console.error(`ci.standingPr.branch is '${branch}', but:\n${mismatches.map((m) => `  ${m}`).join('\n')}`);
  process.exit(1);
}

console.log(`Workflow guards match ci.standingPr.branch ('${branch}').`);
