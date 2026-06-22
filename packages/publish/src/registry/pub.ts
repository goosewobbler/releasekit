import * as fs from 'node:fs';
import * as path from 'node:path';
import { createPublishError, PublishErrorCode } from '../errors/index.js';
import type { PipelineContext } from '../types.js';
import { hasPubTokenAuth } from '../utils/auth.js';
import { execCommand } from '../utils/exec.js';
import { detectPubCommand, isPubPackagePublished, parsePubspec } from '../utils/pub.js';
import type { Registry, RegistryTarget } from './types.js';

const ALREADY_PUBLISHED_PATTERN = /already published|version already exists/i;

/** Hosts that mean "publish to pub.dev" (the default when `publish_to` is unset). */
const PUB_DEV_HOSTS = ['https://pub.dev', 'https://pub.dartlang.org'];

interface PubTarget extends RegistryTarget {
  dir: string;
  command: 'dart' | 'flutter';
  publishTo: string | undefined;
}

/**
 * Whether a package's `publish_to` targets pub.dev. `dart pub publish` honours a custom
 * `publish_to` (a private registry), but the pub.dev REST API checks here only make sense
 * for pub.dev, so they are skipped for custom servers.
 */
function targetsPubDev(publishTo: string | undefined): boolean {
  return !publishTo || PUB_DEV_HOSTS.includes(publishTo.replace(/\/+$/, ''));
}

/** Error strategy: FAIL-FAST. First publish failure aborts the stage. */
export const pubRegistry: Registry<PubTarget, void> = {
  id: 'pub',
  displayName: 'pub.dev',
  alreadyPublishedNote: ' on pub.dev',
  disabledLog: { level: 'debug', message: 'Pub publishing disabled in config' },
  publishErrorCode: PublishErrorCode.PUB_PUBLISH_ERROR,
  alreadyPublishedPattern: ALREADY_PUBLISHED_PATTERN,

  isEnabled: (config) => config.pub.enabled,

  // Pub never fails fast on missing auth: it either uses PUB_TOKEN (registered in `prepare`,
  // only when there is something to publish) or assumes OIDC automated publishing.
  async authCheck(): Promise<void> {},

  async discover(ctx: PipelineContext): Promise<PubTarget[]> {
    const packages = findPubPackages(
      ctx.input.updates.map((u) => ({ dir: path.dirname(path.resolve(ctx.cwd, u.filePath)), ...u })),
    );
    return orderPubPackages(packages, ctx.config.pub.publishOrder);
  },

  async prepare(ctx: PipelineContext): Promise<void> {
    // If PUB_TOKEN is set, configure it before publishing; otherwise assume OIDC automated publishing.
    // Wrap the token setup so a failure here is attributed to auth (with remediation hints) rather
    // than surfacing as a raw exec error against an unknown stage.
    if (hasPubTokenAuth() && !ctx.cliOptions.dryRun) {
      try {
        await execCommand('dart', ['pub', 'token', 'add', 'https://pub.dev', '--env-var', 'PUB_TOKEN'], {
          cwd: ctx.cwd,
          dryRun: false,
          label: 'dart pub token add',
        });
      } catch (error) {
        throw createPublishError(
          PublishErrorCode.PUB_AUTH_ERROR,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  },

  async isPublished(target: PubTarget): Promise<boolean> {
    // The pub.dev REST API only makes sense for pub.dev targets; skip it for custom registries.
    if (!targetsPubDev(target.publishTo)) return false;
    return isPubPackagePublished(target.packageName, target.version);
  },

  async publish(target: PubTarget, ctx: PipelineContext): Promise<void> {
    await execCommand(target.command, ['pub', 'publish', '--force'], {
      cwd: target.dir,
      dryRun: ctx.cliOptions.dryRun,
      label: `${target.command} pub publish ${target.packageName}@${target.version}`,
      timeout: 10 * 60 * 1000, // 10 minutes timeout
    });
  },
};

function findPubPackages(updates: Array<{ newVersion: string; filePath: string; dir: string }>): PubTarget[] {
  const packages: PubTarget[] = [];
  const seen = new Set<string>();

  for (const update of updates) {
    const pubspecPath = path.join(update.dir, 'pubspec.yaml');
    if (!fs.existsSync(pubspecPath) || seen.has(pubspecPath)) {
      continue;
    }
    seen.add(pubspecPath);

    try {
      const pubspec = parsePubspec(pubspecPath);
      if (!pubspec.name || pubspec.publish_to === 'none') {
        continue;
      }

      packages.push({
        packageName: pubspec.name,
        version: update.newVersion,
        dir: update.dir,
        command: detectPubCommand(pubspec.environment as Record<string, unknown> | undefined),
        publishTo: pubspec.publish_to,
      });
    } catch (error) {
      throw createPublishError(
        PublishErrorCode.PUBSPEC_YAML_ERROR,
        `${pubspecPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return packages;
}

function orderPubPackages(packages: PubTarget[], explicitOrder: string[]): PubTarget[] {
  if (explicitOrder.length === 0) {
    return packages;
  }

  const ordered: PubTarget[] = [];
  const byName = new Map(packages.map((p) => [p.packageName, p]));

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
