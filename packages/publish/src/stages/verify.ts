import { debug, info, success, warn } from '@releasekit/core';
import type { PipelineContext, VerificationResult } from '../types.js';
import { execCommandSafe } from '../utils/exec.js';
import { buildViewCommand } from '../utils/package-manager.js';
import { withRetry } from '../utils/retry.js';

export async function runVerifyStage(ctx: PipelineContext): Promise<void> {
  const { config, cliOptions, output, cwd } = ctx;

  // Verify NPM packages
  if (config.verify.npm.enabled) {
    const published = output.npm.filter((r) => r.success && !r.skipped && !r.alreadyPublished);

    for (const pkg of published) {
      const result: VerificationResult = {
        packageName: pkg.packageName,
        version: pkg.version,
        registry: 'npm',
        verified: false,
        attempts: 0,
      };

      if (cliOptions.dryRun) {
        info(`[DRY RUN] Would verify ${pkg.packageName}@${pkg.version} on npm`);
        result.verified = true;
        ctx.output.verification.push(result);
        continue;
      }

      try {
        await withRetry(async () => {
          result.attempts++;
          const { file: viewFile, args: viewArgs } = buildViewCommand(ctx.packageManager, pkg.packageName, pkg.version);
          const viewResult = await execCommandSafe(viewFile, viewArgs, {
            cwd,
            dryRun: false,
          });

          if (viewResult.exitCode !== 0 || !viewResult.stdout.trim()) {
            throw new Error(`${pkg.packageName}@${pkg.version} not yet available on npm`);
          }

          debug(`Verified ${pkg.packageName}@${pkg.version} on npm`);
        }, config.verify.npm);
        result.verified = true;
        success(`Verified ${pkg.packageName}@${pkg.version} on npm`);
      } catch {
        warn(`Failed to verify ${pkg.packageName}@${pkg.version} on npm after ${result.attempts} attempts`);
      }

      ctx.output.verification.push(result);
    }
  }

  // Verify Cargo crates
  if (config.verify.cargo.enabled) {
    const published = output.cargo.filter((r) => r.success && !r.skipped && !r.alreadyPublished);

    for (const crate of published) {
      const result: VerificationResult = {
        packageName: crate.packageName,
        version: crate.version,
        registry: 'cargo',
        verified: false,
        attempts: 0,
      };

      if (cliOptions.dryRun) {
        info(`[DRY RUN] Would verify ${crate.packageName}@${crate.version} on crates.io`);
        result.verified = true;
        ctx.output.verification.push(result);
        continue;
      }

      try {
        await withRetry(async () => {
          result.attempts++;
          const response = await fetch(`https://crates.io/api/v1/crates/${crate.packageName}/${crate.version}`);

          if (!response.ok) {
            throw new Error(`${crate.packageName}@${crate.version} not yet available on crates.io`);
          }

          debug(`Verified ${crate.packageName}@${crate.version} on crates.io`);
        }, config.verify.cargo);
        result.verified = true;
        success(`Verified ${crate.packageName}@${crate.version} on crates.io`);
      } catch {
        warn(`Failed to verify ${crate.packageName}@${crate.version} on crates.io after ${result.attempts} attempts`);
      }

      ctx.output.verification.push(result);
    }
  }
}
