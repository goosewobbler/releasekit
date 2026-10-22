import * as fs from 'node:fs';
import * as path from 'node:path';
import { type CargoLockBump, debug, info, isPathWithinRoot } from '@releasekit/core';
import { createPublishError, PublishErrorCode } from '../errors/index.js';
import type { PipelineContext } from '../types.js';
import { syncCargoLockfiles, updateCargoVersion } from '../utils/cargo.js';

export async function runPrepareStage(ctx: PipelineContext): Promise<void> {
  const { input, config, cliOptions, cwd } = ctx;

  // Copy files (e.g., LICENSE) to each package directory
  if (config.npm.enabled && config.npm.copyFiles.length > 0) {
    for (const update of input.updates) {
      const pkgDir = path.dirname(path.resolve(cwd, update.filePath));

      for (const file of config.npm.copyFiles) {
        const src = path.resolve(cwd, file);
        const dest = path.join(pkgDir, file);

        // Confine both the read source and the write destination to the repo root — a `../` or
        // absolute copyFiles entry would otherwise read or write outside the tree.
        if (!isPathWithinRoot(cwd, src) || !isPathWithinRoot(cwd, dest)) {
          throw createPublishError(
            PublishErrorCode.FILE_COPY_ERROR,
            `Refusing to copy '${file}': it resolves outside the repository root (${cwd})`,
          );
        }

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
    // Re-synced here so the direct-commit flow, which stages an explicit file list, commits every lock
    // that records a bump. A no-op in the standing-PR flow, which stages with `git add -A`.
    const bumps: Array<Omit<CargoLockBump, 'name'>> = [];
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
      bumps.push({ cargoTomlPath: cargoPath, version: update.newVersion });
    }

    const lockfiles = await syncCargoLockfiles(cwd, bumps);
    // A hybrid package's update points at its package.json, so git-commit wouldn't stage its Cargo.toml.
    const written = [...bumps.map((bump) => bump.cargoTomlPath), ...lockfiles];
    if (written.length > 0) {
      ctx.additionalFiles = [...new Set([...(ctx.additionalFiles ?? []), ...written])];
    }
  }
}
