#!/usr/bin/env node
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface PackageUpdate {
  packageName: string;
  newVersion: string;
  filePath: string;
}

interface VersionOutput {
  updates: PackageUpdate[];
}

function getNpmTag(version: string): string {
  return version.includes('-') ? 'next' : 'latest';
}

function publishPackage(packageDir: string, packageName: string, npmTag: string): void {
  console.log(`Publishing ${packageName} with tag ${npmTag} from ${packageDir}...`);
  execSync(`npm publish --tag ${npmTag} --provenance --access public`, {
    stdio: 'inherit',
    cwd: packageDir,
  });
}

function main(): void {
  const versionOutputPath = process.argv[2];
  const dryRun = process.argv[3] === 'true';

  if (!versionOutputPath) {
    console.error('Usage: publish-packages.ts <version-output.json> [dry-run]');
    process.exit(1);
  }

  const versionOutput: VersionOutput = JSON.parse(fs.readFileSync(versionOutputPath, 'utf-8'));

  const packages = ['@releasekit/version', '@releasekit/notes', '@releasekit/publish', '@releasekit/release'];

  for (const packageName of packages) {
    const update = versionOutput.updates.find((u) => u.packageName === packageName);

    if (!update) {
      console.log(`No update for ${packageName}, skipping`);
      continue;
    }

    const npmTag = getNpmTag(update.newVersion);
    const packageDir = path.dirname(path.resolve(update.filePath));

    if (dryRun) {
      console.log(`[DRY RUN] Would publish ${packageName}@${update.newVersion} with tag ${npmTag}`);
    } else {
      publishPackage(packageDir, packageName, npmTag);
    }
  }
}

main();
