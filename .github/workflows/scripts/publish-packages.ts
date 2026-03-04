#!/usr/bin/env node
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';

interface PackageUpdate {
  packageName: string;
  newVersion: string;
}

interface VersionOutput {
  updates: PackageUpdate[];
}

function getNpmTag(version: string): string {
  return version.includes('-') ? 'next' : 'latest';
}

function publishPackage(packageName: string, npmTag: string): void {
  console.log(`Publishing ${packageName} with tag ${npmTag}...`);
  execSync(`pnpm --filter ${packageName} publish --tag ${npmTag} --no-git-checks`, {
    stdio: 'inherit',
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

    if (dryRun) {
      console.log(`[DRY RUN] Would publish ${packageName}@${update.newVersion} with tag ${npmTag}`);
    } else {
      publishPackage(packageName, npmTag);
    }
  }
}

main();
