import * as fs from 'node:fs';
import * as path from 'node:path';
import { debug, info, success, warn } from '@releasekit/core';
import { createPublishError, PublishErrorCode } from '../errors/index.js';
import type { PipelineContext, PublishResult } from '../types.js';
import { detectNpmAuth } from '../utils/auth.js';
import { execCommand, execCommandSafe } from '../utils/exec.js';
import { createNpmSubprocessIsolation } from '../utils/npm-env.js';
import { buildPublishCommand, buildViewCommand } from '../utils/package-manager.js';
import { getDistTag } from '../utils/semver.js';

/** Error strategy: FAIL-FAST. First publish failure aborts the stage. */
export async function runNpmPublishStage(ctx: PipelineContext): Promise<void> {
  const { input, config, cliOptions, cwd } = ctx;
  const dryRun = cliOptions.dryRun;

  if (!config.npm.enabled) {
    info('NPM publishing disabled in config');
    return;
  }

  // Detect auth method
  const authMethod = config.npm.auth === 'auto' ? detectNpmAuth() : config.npm.auth;

  if (!authMethod && !dryRun) {
    throw createPublishError(PublishErrorCode.NPM_AUTH_ERROR, 'No NPM authentication method detected');
  }

  const useProvenance = config.npm.provenance && authMethod === 'oidc';
  const npmIsolation = createNpmSubprocessIsolation({
    authMethod,
    registryUrl: config.npm.registry,
  });

  try {
    for (const update of input.updates) {
      const result: PublishResult = {
        packageName: update.packageName,
        version: update.newVersion,
        registry: 'npm',
        success: false,
        skipped: false,
      };

      // Check if package is private
      const pkgJsonPath = path.resolve(cwd, update.filePath);
      try {
        const pkgContent = fs.readFileSync(pkgJsonPath, 'utf-8');
        const pkgJson = JSON.parse(pkgContent);
        if (pkgJson.private) {
          result.skipped = true;
          result.success = true;
          result.reason = 'Package is private';
          ctx.output.npm.push(result);
          debug(`Skipping private package: ${update.packageName}`);
          continue;
        }
      } catch {
        // If we can't read package.json, it might be a Cargo.toml package
        if (update.filePath.endsWith('Cargo.toml')) {
          result.skipped = true;
          result.success = true;
          result.reason = 'Not an npm package';
          ctx.output.npm.push(result);
          continue;
        }
      }

      // Check if already published
      const { file: viewFile, args: viewArgs } = buildViewCommand(
        ctx.packageManager,
        update.packageName,
        update.newVersion,
      );
      const viewResult = await execCommandSafe(viewFile, viewArgs, {
        cwd,
        dryRun: false, // Always check, even in dry-run
        env: npmIsolation.env,
      });

      if (viewResult.exitCode === 0 && viewResult.stdout.trim()) {
        result.alreadyPublished = true;
        result.skipped = true;
        result.success = true;
        result.reason = 'Already published';
        ctx.output.npm.push(result);
        warn(`${update.packageName}@${update.newVersion} is already published, skipping`);
        continue;
      }

      // Build publish command
      const distTag = getDistTag(update.newVersion, config.npm.tag);
      const pkgDir = path.dirname(path.resolve(cwd, update.filePath));
      const { file: pubFile, args: pubArgs } = buildPublishCommand(ctx.packageManager, update.packageName, pkgDir, {
        access: config.npm.access,
        tag: distTag,
        provenance: useProvenance,
        noGitChecks: true,
      });

      try {
        await execCommand(pubFile, pubArgs, {
          cwd,
          dryRun,
          label: `npm publish ${update.packageName}@${update.newVersion}`,
          env: npmIsolation.env,
        });
        result.success = true;
        if (!dryRun) {
          success(`Published ${update.packageName}@${update.newVersion} to npm`);
        }
        ctx.output.npm.push(result);
      } catch (error) {
        result.reason = error instanceof Error ? error.message : String(error);
        ctx.output.npm.push(result);
        throw createPublishError(
          PublishErrorCode.NPM_PUBLISH_ERROR,
          `${update.packageName}@${update.newVersion}: ${result.reason}`,
        );
      }
    }
  } finally {
    npmIsolation.cleanup();
  }
}
