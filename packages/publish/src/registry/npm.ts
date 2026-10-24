import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildDependencyGraph, debug, type GraphPackage, isPrivatePackageJson } from '@releasekit/core';
import { createPublishError, PublishErrorCode } from '../errors/index.js';
import type { PipelineContext } from '../types.js';
import { detectNpmAuth } from '../utils/auth.js';
import { execCommand, execCommandSafe } from '../utils/exec.js';
import { createNpmSubprocessIsolation, type NpmEnvIsolation } from '../utils/npm-env.js';
import { buildPublishCommand, buildViewCommand } from '../utils/package-manager.js';
import { getDistTag } from '../utils/semver.js';
import type { Registry, RegistryTarget, SkipDecision } from './types.js';

const ALREADY_PUBLISHED_PATTERN = /EPUBLISHCONFLICT|cannot publish over (?:the )?previously published versions?/i;

interface NpmTarget extends RegistryTarget {
  filePath: string;
}

interface NpmSession {
  useProvenance: boolean;
  isolation: NpmEnvIsolation;
}

export function readNpmWorkspaceDeps(pkgJsonPath: string): string[] {
  try {
    const json = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    return [...Object.keys(json.dependencies ?? {}), ...Object.keys(json.peerDependencies ?? {})];
  } catch (error) {
    // Unreadable deps look dependency-free to the graph and could order a package ahead of its own
    // dependencies - surface it rather than silently mis-ordering.
    debug(`Failed to read workspace deps from ${pkgJsonPath}: ${error}`);
    return [];
  }
}

/**
 * Dependencies publish first, closing the window where a just-published package references a
 * not-yet-published version. Non-npm updates go last - the stage skips them anyway.
 */
export function orderNpmUpdates<T extends { packageName: string; filePath: string }>(
  updates: T[],
  explicitOrder: string[],
  cwd: string,
): T[] {
  const npm = updates.filter((u) => u.filePath.endsWith('package.json'));
  if (npm.length <= 1) {
    return updates;
  }
  const other = updates.filter((u) => !u.filePath.endsWith('package.json'));
  const byName = new Map(npm.map((u) => [u.packageName, u]));

  let orderedNames: string[];
  if (explicitOrder.length > 0) {
    const remaining = new Set(npm.map((u) => u.packageName));
    orderedNames = explicitOrder.filter((n) => remaining.has(n));
    for (const n of orderedNames) {
      remaining.delete(n);
    }
    for (const u of npm) {
      if (remaining.has(u.packageName)) {
        orderedNames.push(u.packageName);
      }
    }
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

export const npmRegistry: Registry<NpmTarget, NpmSession> = {
  id: 'npm',
  displayName: 'npm',
  alreadyPublishedNote: '',
  disabledLog: { level: 'info', message: 'NPM publishing disabled in config' },
  publishErrorCode: PublishErrorCode.NPM_PUBLISH_ERROR,
  alreadyPublishedPattern: ALREADY_PUBLISHED_PATTERN,

  isEnabled: (config) => config.npm.enabled,

  async authCheck(ctx: PipelineContext): Promise<NpmSession> {
    const { config } = ctx;
    const authMethod = config.npm.auth === 'auto' ? detectNpmAuth() : config.npm.auth;
    debug(`NPM auth method: ${authMethod}`);

    if (!authMethod && !ctx.cliOptions.dryRun) {
      throw createPublishError(PublishErrorCode.NPM_AUTH_ERROR, 'No NPM authentication method detected');
    }

    const useProvenance = config.npm.provenance && authMethod === 'oidc';
    debug(`Using provenance: ${useProvenance}`);
    const isolation = createNpmSubprocessIsolation({ authMethod, registryUrl: config.npm.registry });
    return { useProvenance, isolation };
  },

  async discover(ctx: PipelineContext): Promise<NpmTarget[]> {
    const targets = ctx.input.updates.map((u) => ({
      packageName: u.packageName,
      updatePackageName: u.packageName,
      version: u.newVersion,
      filePath: u.filePath,
    }));
    return orderNpmUpdates(targets, ctx.config.npm.publishOrder, ctx.cwd);
  },

  precheckSkip(target: NpmTarget, ctx: PipelineContext): SkipDecision | undefined {
    // Cargo and pub manifests flow through here too; skip them before JSON.parse chokes on TOML/YAML and
    // emits a confusing "Failed to read package.json" debug.
    if (!target.filePath.endsWith('package.json')) {
      return { reason: 'Not an npm package' };
    }

    const pkgJsonPath = path.resolve(ctx.cwd, target.filePath);
    let pkgJson: { private?: unknown } | undefined;
    try {
      const parsed = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      pkgJson = parsed;
      debug(`Package.json files field: ${JSON.stringify(parsed.files)}`);
      debug(`Package.json version: ${parsed.version}`);
      debug(`Package.json name: ${parsed.name}`);
    } catch (error) {
      debug(`Failed to read package.json: ${error}`);
    }

    // Validate `private` OUTSIDE the parse try/catch: a quoted `"private": "true"` must abort the
    // publish, not get swallowed as a "malformed package.json" and then published (irreversible).
    if (isPrivatePackageJson(pkgJson, pkgJsonPath)) {
      debug(`Skipping private package: ${target.packageName}`);
      return { reason: 'Package is private' };
    }
    return undefined;
  },

  async isPublished(target: NpmTarget, ctx: PipelineContext, session: NpmSession): Promise<boolean> {
    const { file, args } = buildViewCommand(ctx.packageManager, target.packageName, target.version);
    const viewResult = await execCommandSafe(file, args, {
      cwd: ctx.cwd,
      dryRun: false,
      env: session.isolation.env,
    });
    return viewResult.exitCode === 0 && viewResult.stdout.trim() !== '';
  },

  async prePublish(target: NpmTarget, ctx: PipelineContext): Promise<void> {
    const pkgDir = path.dirname(path.resolve(ctx.cwd, target.filePath));

    const distExists = fs.existsSync(path.join(pkgDir, 'dist'));
    debug(`Publishing ${target.packageName}@${target.version} from ${pkgDir}`);
    debug(`Dist directory exists: ${distExists}`);
    if (distExists) {
      const distContents = fs.readdirSync(path.join(pkgDir, 'dist'));
      debug(`Dist directory contents: ${distContents.join(', ')}`);
    }

    try {
      const versionResult = await execCommand(ctx.packageManager, ['--version'], { cwd: ctx.cwd, dryRun: false });
      debug(`Package manager version (${ctx.packageManager}): ${versionResult.stdout.trim()}`);
    } catch (error) {
      debug(`Failed to get package manager version: ${error}`);
    }
  },

  async publish(target: NpmTarget, ctx: PipelineContext, session: NpmSession): Promise<void> {
    const distTag = getDistTag(target.version, ctx.config.npm.tag);
    const pkgDir = path.dirname(path.resolve(ctx.cwd, target.filePath));
    const { file, args } = buildPublishCommand(ctx.packageManager, target.packageName, pkgDir, {
      access: ctx.config.npm.access,
      tag: distTag,
      provenance: session.useProvenance,
      noGitChecks: true,
    });

    debug(`Publish command: ${file} ${args.join(' ')}`);
    debug(`Working directory: ${pkgDir}`);

    const publishResult = await execCommand(file, args, {
      cwd: pkgDir,
      dryRun: ctx.cliOptions.dryRun,
      label: `npm publish ${target.packageName}@${target.version}`,
      env: session.isolation.env,
    });

    debug('Publish command completed successfully');
    if (publishResult.stdout) {
      debug(`Publish stdout: ${publishResult.stdout}`);
    }
    if (publishResult.stderr) {
      debug(`Publish stderr: ${publishResult.stderr}`);
    }
  },

  dispose(session: NpmSession): void {
    session.isolation.cleanup();
  },
};
