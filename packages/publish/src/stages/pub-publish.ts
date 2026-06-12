import * as fs from 'node:fs';
import * as path from 'node:path';
import { debug, success, warn } from '@releasekit/core';
import { createPublishError, PublishErrorCode } from '../errors/index.js';
import type { PipelineContext, PublishResult } from '../types.js';
import { hasPubTokenAuth } from '../utils/auth.js';
import { execCommand } from '../utils/exec.js';
import { detectPubCommand, isPubPackagePublished, parsePubspec } from '../utils/pub.js';
import { classifyPublishError, withPublishRetry } from '../utils/publish-retry.js';

const ALREADY_PUBLISHED_PATTERN = /already published|version already exists/i;

/** Bounded auto-retry for transient registry blips: initial attempt + 2 retries. */
const PUBLISH_RETRY = { maxAttempts: 3, initialDelay: 1000 } as const;

/** Error strategy: FAIL-FAST. First publish failure aborts the stage. */
export async function runPubPublishStage(ctx: PipelineContext): Promise<void> {
  const { input, config, cliOptions, cwd } = ctx;
  const dryRun = cliOptions.dryRun;

  if (!config.pub.enabled) {
    debug('Pub publishing disabled in config');
    return;
  }

  // If PUB_TOKEN is set, configure it before publishing; otherwise assume OIDC automated publishing
  if (hasPubTokenAuth() && !dryRun) {
    await execCommand('dart', ['pub', 'token', 'add', 'https://pub.dev', '--env-var', 'PUB_TOKEN'], {
      cwd,
      dryRun: false,
      label: 'dart pub token add',
    });
  }

  // Find Dart packages to publish
  const packages = findPubPackages(
    input.updates.map((u) => ({ dir: path.dirname(path.resolve(cwd, u.filePath)), ...u })),
    cwd,
  );

  if (packages.length === 0) {
    debug('No Dart packages found to publish');
    return;
  }

  // Apply explicit publish order if configured
  const ordered = orderPubPackages(packages, config.pub.publishOrder);

  for (const pkg of ordered) {
    const result: PublishResult = {
      packageName: pkg.name,
      version: pkg.version,
      registry: 'pub',
      success: false,
      skipped: false,
    };

    // Check if already published via the pub.dev API
    if (await isPubPackagePublished(pkg.name, pkg.version)) {
      result.alreadyPublished = true;
      result.skipped = true;
      result.success = true;
      result.reason = 'Already published on pub.dev';
      ctx.output.pub.push(result);
      warn(`${pkg.name}@${pkg.version} is already published on pub.dev, skipping`);
      continue;
    }

    const cmd = detectPubCommand(pkg.pubspecPath);
    const publishArgs = ['pub', 'publish', '--force'];

    try {
      await withPublishRetry(
        () =>
          execCommand(cmd, publishArgs, {
            cwd: pkg.dir,
            dryRun,
            label: `${cmd} pub publish ${pkg.name}@${pkg.version}`,
            timeout: 10 * 60 * 1000, // 10 minutes timeout
          }),
        {
          ...PUBLISH_RETRY,
          label: `${pkg.name}@${pkg.version}`,
          shouldRetry: (error) =>
            !ALREADY_PUBLISHED_PATTERN.test(String(error)) && classifyPublishError(error) === 'transient',
          onAttempt: (attempt) => {
            result.attempts = attempt;
          },
        },
      );
      result.success = true;
      if (!dryRun) {
        success(`Published ${pkg.name}@${pkg.version} to pub.dev`);
      }
      ctx.output.pub.push(result);
    } catch (error) {
      if (ALREADY_PUBLISHED_PATTERN.test(String(error))) {
        result.alreadyPublished = true;
        result.skipped = true;
        result.success = true;
        result.reason = 'Already published on pub.dev (detected from publish error)';
        ctx.output.pub.push(result);
        warn(`${pkg.name}@${pkg.version} is already published on pub.dev, skipping`);
        continue;
      }
      result.reason = error instanceof Error ? error.message : String(error);
      ctx.output.pub.push(result);
      throw createPublishError(PublishErrorCode.PUB_PUBLISH_ERROR, `${pkg.name}@${pkg.version}: ${result.reason}`);
    }
  }
}

interface PubPackageInfo {
  name: string;
  version: string;
  dir: string;
  pubspecPath: string;
}

function findPubPackages(
  updates: Array<{ packageName: string; newVersion: string; filePath: string; dir: string }>,
  _cwd: string,
): PubPackageInfo[] {
  const packages: PubPackageInfo[] = [];
  const seen = new Set<string>();

  for (const update of updates) {
    const pubspecPath = path.join(update.dir, 'pubspec.yaml');
    if (!fs.existsSync(pubspecPath) || seen.has(pubspecPath)) {
      continue;
    }
    seen.add(pubspecPath);

    try {
      const pubspec = parsePubspec(pubspecPath);
      if (!pubspec.name) {
        continue;
      }

      packages.push({
        name: pubspec.name,
        version: update.newVersion,
        dir: update.dir,
        pubspecPath,
      });
    } catch {
      // Skip unparseable pubspec.yaml
    }
  }

  return packages;
}

function orderPubPackages(packages: PubPackageInfo[], explicitOrder: string[]): PubPackageInfo[] {
  if (explicitOrder.length === 0) {
    return packages;
  }

  const ordered: PubPackageInfo[] = [];
  const byName = new Map(packages.map((p) => [p.name, p]));

  for (const name of explicitOrder) {
    const pkg = byName.get(name);
    if (pkg) {
      ordered.push(pkg);
      byName.delete(name);
    }
  }

  // Append remaining packages not in explicit order
  for (const pkg of byName.values()) {
    ordered.push(pkg);
  }

  return ordered;
}
