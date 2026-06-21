import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildDependencyGraph, debug, type GraphPackage, info, success, warn } from '@releasekit/core';
import { createPublishError, PublishErrorCode } from '../errors/index.js';
import type { PipelineContext, PublishResult } from '../types.js';
import { detectNpmAuth } from '../utils/auth.js';
import { execCommand, execCommandSafe, getExecErrorOutput } from '../utils/exec.js';
import { createNpmSubprocessIsolation } from '../utils/npm-env.js';
import { buildPublishCommand, buildViewCommand } from '../utils/package-manager.js';
import { classifyPublishError, withPublishRetry } from '../utils/publish-retry.js';
import { getDistTag } from '../utils/semver.js';

const ALREADY_PUBLISHED_PATTERN = /EPUBLISHCONFLICT|cannot publish over (?:the )?previously published versions?/i;

/** Bounded auto-retry for transient registry blips: initial attempt + 2 retries. */
const PUBLISH_RETRY = { maxAttempts: 3, initialDelay: 1000 } as const;

/** Workspace deps an npm package declares (dependencies + peerDependencies; devDependencies excluded). */
function readNpmWorkspaceDeps(pkgJsonPath: string): string[] {
  try {
    const json = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    return [...Object.keys(json.dependencies ?? {}), ...Object.keys(json.peerDependencies ?? {})];
  } catch {
    return [];
  }
}

/**
 * Order npm updates so a dependency publishes before any package that depends on it, closing the
 * window where a just-published package references a not-yet-published version. An explicit
 * `publishOrder` wins (matching cargo); otherwise the workspace graph topo-sorts dependencies first.
 * Non-npm updates keep their position — the stage skips them anyway.
 */
export function orderNpmUpdates<T extends { packageName: string; filePath: string }>(
  updates: T[],
  explicitOrder: string[],
  cwd: string,
): T[] {
  const npm = updates.filter((u) => u.filePath.endsWith('package.json'));
  if (npm.length <= 1) return updates;
  const other = updates.filter((u) => !u.filePath.endsWith('package.json'));
  const byName = new Map(npm.map((u) => [u.packageName, u]));

  let orderedNames: string[];
  if (explicitOrder.length > 0) {
    const remaining = new Set(npm.map((u) => u.packageName));
    orderedNames = explicitOrder.filter((n) => remaining.has(n));
    for (const n of orderedNames) remaining.delete(n);
    for (const u of npm) if (remaining.has(u.packageName)) orderedNames.push(u.packageName);
  } else {
    const graphPackages: GraphPackage[] = npm.map((u) => {
      const pkgJsonPath = path.resolve(cwd, u.filePath);
      return {
        name: u.packageName,
        dir: path.dirname(pkgJsonPath),
        ecosystem: 'npm',
        deps: readNpmWorkspaceDeps(pkgJsonPath),
      };
    });
    orderedNames = buildDependencyGraph(graphPackages).topologicalOrder(npm.map((u) => u.packageName));
  }

  const orderedNpm = orderedNames.map((n) => byName.get(n)).filter((u): u is T => u !== undefined);
  return [...orderedNpm, ...other];
}

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
  debug(`NPM auth method: ${authMethod}`);

  if (!authMethod && !dryRun) {
    throw createPublishError(PublishErrorCode.NPM_AUTH_ERROR, 'No NPM authentication method detected');
  }

  const useProvenance = config.npm.provenance && authMethod === 'oidc';
  debug(`Using provenance: ${useProvenance}`);
  const npmIsolation = createNpmSubprocessIsolation({
    authMethod,
    registryUrl: config.npm.registry,
  });

  try {
    const orderedUpdates = orderNpmUpdates(input.updates, config.npm.publishOrder, cwd);
    for (const update of orderedUpdates) {
      const result: PublishResult = {
        packageName: update.packageName,
        version: update.newVersion,
        registry: 'npm',
        success: false,
        skipped: false,
      };

      // Only npm packages have a package.json; cargo (Cargo.toml) and pub (pubspec.yaml) manifests
      // flow through here too. Skip non-package.json manifests up front so we never JSON.parse a
      // TOML/YAML file and emit a confusing "Failed to read package.json" debug.
      if (!update.filePath.endsWith('package.json')) {
        result.skipped = true;
        result.success = true;
        result.reason = 'Not an npm package';
        ctx.output.npm.push(result);
        continue;
      }

      // Check if package is private
      const pkgJsonPath = path.resolve(cwd, update.filePath);
      let pkgJson: any = {};
      try {
        const pkgContent = fs.readFileSync(pkgJsonPath, 'utf-8');
        pkgJson = JSON.parse(pkgContent);
        debug(`Package.json files field: ${JSON.stringify(pkgJson.files)}`);
        debug(`Package.json version: ${pkgJson.version}`);
        debug(`Package.json name: ${pkgJson.name}`);

        if (pkgJson.private) {
          result.skipped = true;
          result.success = true;
          result.reason = 'Package is private';
          ctx.output.npm.push(result);
          debug(`Skipping private package: ${update.packageName}`);
          continue;
        }
      } catch (error) {
        // A genuinely unreadable/malformed package.json — log and continue with empty metadata.
        debug(`Failed to read package.json: ${error}`);
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

      debug(`Publish command: ${pubFile} ${pubArgs.join(' ')}`);
      debug(`Working directory: ${pkgDir}`);

      // Debug: Check if dist directory exists before publishing
      const distExists = fs.existsSync(path.join(pkgDir, 'dist'));
      debug(`Publishing ${update.packageName}@${update.newVersion} from ${pkgDir}`);
      debug(`Dist directory exists: ${distExists}`);
      if (distExists) {
        const distContents = fs.readdirSync(path.join(pkgDir, 'dist'));
        debug(`Dist directory contents: ${distContents.join(', ')}`);
      }

      // Check package manager version
      try {
        const versionResult = await execCommand(ctx.packageManager, ['--version'], {
          cwd,
          dryRun: false,
        });
        debug(`Package manager version (${ctx.packageManager}): ${versionResult.stdout.trim()}`);
      } catch (error) {
        debug(`Failed to get package manager version: ${error}`);
      }

      try {
        // Transient registry errors (5xx, timeouts, rate limits) are retried with
        // backoff; permanent errors (auth, validation) fail fast. The
        // already-published conflict is detected inside the retried function and
        // surfaced as a non-retryable skip, so a retry of a "publish landed but the
        // response was lost" case resolves as a skip rather than a duplicate publish.
        await withPublishRetry(
          async () => {
            const publishResult = await execCommand(pubFile, pubArgs, {
              cwd: pkgDir, // Always publish from the package directory for reliability
              dryRun,
              label: `npm publish ${update.packageName}@${update.newVersion}`,
              env: npmIsolation.env,
            });

            debug(`Publish command completed successfully`);
            if (publishResult.stdout) debug(`Publish stdout: ${publishResult.stdout}`);
            if (publishResult.stderr) debug(`Publish stderr: ${publishResult.stderr}`);
          },
          {
            ...PUBLISH_RETRY,
            label: `${update.packageName}@${update.newVersion}`,
            // Never retry an already-published conflict — it is handled as a skip below.
            shouldRetry: (error) =>
              !ALREADY_PUBLISHED_PATTERN.test(getExecErrorOutput(error)) && classifyPublishError(error) === 'transient',
            // Recorded via callback (not the return value) so the failure paths
            // below — including exhaustion — still carry the attempt count.
            onAttempt: (attempt) => {
              result.attempts = attempt;
            },
          },
        );

        result.success = true;
        if (!dryRun) {
          success(`Published ${update.packageName}@${update.newVersion} to npm`);
        }
        ctx.output.npm.push(result);
      } catch (error) {
        debug(`Publish command failed: ${error}`);
        // If `npm view` and `npm publish` disagreed (rare — usually a transient view
        // failure), treat the conflict as already-published so re-runs of a partially
        // failed release are idempotent. This also covers the case where a retried
        // publish lands but the registry response was lost on the first attempt.
        if (ALREADY_PUBLISHED_PATTERN.test(getExecErrorOutput(error))) {
          result.alreadyPublished = true;
          result.skipped = true;
          result.success = true;
          result.reason = 'Already published (detected from publish error)';
          ctx.output.npm.push(result);
          warn(`${update.packageName}@${update.newVersion} is already published, skipping`);
          continue;
        }
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
