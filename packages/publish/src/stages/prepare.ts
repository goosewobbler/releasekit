import * as fs from 'node:fs';
import * as path from 'node:path';
import { debug, findCargoLockfile, info } from '@releasekit/core';
import { createPublishError, PublishErrorCode } from '../errors/index.js';
import type { PipelineContext } from '../types.js';
import { updateCargoVersion } from '../utils/cargo.js';

export async function runPrepareStage(ctx: PipelineContext): Promise<void> {
  const { input, config, cliOptions, cwd } = ctx;

  // Copy files (e.g., LICENSE) to each package directory
  if (config.npm.enabled && config.npm.copyFiles.length > 0) {
    for (const update of input.updates) {
      const pkgDir = path.dirname(path.resolve(cwd, update.filePath));

      for (const file of config.npm.copyFiles) {
        const src = path.resolve(cwd, file);
        const dest = path.join(pkgDir, file);

        if (!fs.existsSync(src)) {
          debug(`Source file not found, skipping copy: ${src}`);
          continue;
        }

        // Skip if source and destination are the same directory
        if (path.resolve(path.dirname(src)) === path.resolve(pkgDir)) {
          debug(`Skipping copy of ${file} - same directory as source`);
          continue;
        }

        if (cliOptions.dryRun) {
          info(`[DRY RUN] Would copy ${src} → ${dest}`);
          continue;
        }

        try {
          fs.copyFileSync(src, dest);
          debug(`Copied ${file} → ${pkgDir}`);
        } catch (error) {
          throw createPublishError(
            PublishErrorCode.FILE_COPY_ERROR,
            `Failed to copy ${src} to ${dest}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  // Update Cargo.toml versions for cargo packages
  if (config.cargo.enabled) {
    // Cargo.lock files to stage alongside the manifests (#496). The version step already synced each
    // crate's lock self-entry to the bumped version; here we surface it so the direct-commit flow
    // (git-commit, which stages an explicit file list rather than `git add -A`) includes it. The
    // standing-PR flow stages the lock via its own `git add -A`, so this is a no-op there.
    const lockfiles = new Set<string>();
    for (const update of input.updates) {
      const pkgDir = path.dirname(path.resolve(cwd, update.filePath));
      const cargoPath = path.join(pkgDir, 'Cargo.toml');

      if (!fs.existsSync(cargoPath)) {
        continue;
      }

      if (cliOptions.dryRun) {
        info(`[DRY RUN] Would update ${cargoPath} to version ${update.newVersion}`);
        continue;
      }

      updateCargoVersion(cargoPath, update.newVersion);
      debug(`Updated ${cargoPath} to version ${update.newVersion}`);

      const lockPath = findCargoLockfile(pkgDir);
      if (lockPath) lockfiles.add(lockPath);
    }

    if (lockfiles.size > 0) {
      const existing = new Set(ctx.additionalFiles ?? []);
      for (const lock of lockfiles) existing.add(lock);
      ctx.additionalFiles = [...existing];
    }
  }
}
