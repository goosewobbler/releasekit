import * as fs from 'node:fs';
import * as path from 'node:path';
import { debug, info, isPathWithinRoot } from '@releasekit/core';
import { createPublishError, PublishErrorCode } from '../errors/index.js';
import type { PipelineContext } from '../types.js';
import { syncCargoLockfile, updateCargoVersion } from '../utils/cargo.js';

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
    // Cargo.lock files to stage alongside the manifests, deduped — crates in one workspace
    // share a single workspace-root lock. We re-sync the lock here (rather than trust the version
    // step) so the direct-commit flow — git-commit stages an explicit file list, not `git add -A` —
    // is self-sufficient and correct even run in isolation. The standing-PR flow stages the lock via
    // its own `git add -A`, with git-commit skipped, so this re-sync is a harmless no-op there.
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

      const lockPath = await syncCargoLockfile(pkgDir);
      if (lockPath) lockfiles.add(lockPath);
    }

    if (lockfiles.size > 0) {
      const existing = new Set(ctx.additionalFiles ?? []);
      for (const lock of lockfiles) existing.add(lock);
      ctx.additionalFiles = [...existing];
    }
  }
}
