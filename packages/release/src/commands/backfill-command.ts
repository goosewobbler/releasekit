import * as fs from 'node:fs';
import * as path from 'node:path';
import type { VersionOutput } from '@releasekit/core';
import { EXIT_CODES, error, info, success, warn } from '@releasekit/core';
import type { Config as VersionConfig } from '@releasekit/version';
import { Command } from 'commander';
import semver from 'semver';
import { decideReleaseUpdate, editReleaseBody, getReleaseBody, withMarker } from '../backfill/github-release.js';
import { reconstructChangelogs } from '../backfill/reconstruct.js';
import { normalizeRepoUrl } from '../backfill/repo-url.js';

/** A single package to backfill: its name, the directory its commits are scoped to, and repo URL. */
interface BackfillTarget {
  packageName: string;
  pkgPath: string;
  repoUrl: string | null;
}

function readPackageJson(pkgPath: string): { name?: string; repoUrl?: string } {
  const file = path.join(pkgPath, 'package.json');
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch (err) {
    // A missing package.json is expected — the user can pass --package. Anything else (permissions,
    // I/O) is surfaced so a found-but-unreadable file isn't mistaken for "no package.json".
    if ((err as { code?: string }).code !== 'ENOENT') {
      warn(`Could not read ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return {};
  }
  try {
    const pkg = JSON.parse(raw);
    return { name: pkg.name, repoUrl: normalizeRepoUrl(pkg.repository) };
  } catch (err) {
    warn(`Could not parse ${file}: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}

/**
 * Backfill release notes for already-released versions of one or more packages by reconstructing each
 * version's notes from git history. Renders each version through the notes pipeline and writes the
 * result to per-version files (`notes.releaseNotes.file.dir`), to the matching GitHub release bodies
 * (`--update-releases`), or both. Single package by default; `--all` discovers every workspace
 * package. Dry-run by default. (#293 — LLM caching and the Action surface are follow-ups.)
 */
export function createBackfillCommand(): Command {
  return new Command('backfill')
    .description('Regenerate release notes for already-released versions from git history')
    .option('-p, --package <name>', 'Package name (defaults to the package.json name at --path)')
    .option('--path <dir>', 'Package directory', '.')
    .option('--all', 'Backfill every package in the workspace (monorepo discovery)', false)
    .option('--from <version>', 'Earliest version to backfill (inclusive)')
    .option('--to <version>', 'Latest version to backfill (inclusive)')
    .option('--update-releases', 'Update matching GitHub release bodies via `gh release edit`', false)
    .option('--only-missing', 'With --update-releases, skip releases already carrying releasekit notes', false)
    .option('--force', 'Overwrite hand-edited release bodies (use with --update-releases)', false)
    .option('--no-llm', 'Disable LLM (use deterministic, zero-cost backfill)', false)
    .option('--apply', 'Apply changes (default: dry-run preview)', false)
    .option('-c, --config <path>', 'Config file path')
    .action(async (options) => {
      // Validate the bounds up front: reconstructChangelogs feeds them straight to semver.lt/gt,
      // whose SemVer constructor throws a bare TypeError on non-semver input — turn that into a
      // clean CLI error before any work starts.
      for (const [flag, value] of [
        ['--from', options.from],
        ['--to', options.to],
      ] as const) {
        if (value !== undefined && semver.valid(value) === null) {
          error(`${flag} must be a valid semver version (got "${value}").`);
          process.exit(EXIT_CODES.GENERAL_ERROR);
        }
      }
      if (options.all && options.package) {
        error('Pass either --all or --package, not both.');
        process.exit(EXIT_CODES.GENERAL_ERROR);
      }

      const { loadConfig: loadVersionConfig } = await import('@releasekit/version');
      const {
        versionOutputToChangelogInput,
        runPipeline,
        loadConfig: loadNotesConfig,
      } = await import('@releasekit/notes');

      const cwd = process.cwd();
      const updateReleases: boolean = options.updateReleases === true;
      const onlyMissing: boolean = options.onlyMissing === true;
      const notesConfig = loadNotesConfig(cwd, options.config);
      const releaseNotesEnabled = notesConfig.releaseNotes !== false && notesConfig.releaseNotes !== undefined;
      const dir = releaseNotesEnabled ? notesConfig.releaseNotes?.file?.dir : undefined;
      if (!dir && !updateReleases) {
        error(
          'Backfill needs an output: pass --update-releases to update GitHub release bodies, or set ' +
            'notes.releaseNotes.file.dir to write per-version files.',
        );
        process.exit(EXIT_CODES.GENERAL_ERROR);
      }
      if (updateReleases && !releaseNotesEnabled) {
        error('--update-releases needs notes.releaseNotes enabled in your config to render the bodies.');
        process.exit(EXIT_CODES.GENERAL_ERROR);
      }
      if (onlyMissing && !updateReleases) {
        error('--only-missing only applies with --update-releases.');
        process.exit(EXIT_CODES.GENERAL_ERROR);
      }
      if (options.force && !updateReleases) {
        error('--force only applies with --update-releases.');
        process.exit(EXIT_CODES.GENERAL_ERROR);
      }

      const versionConfig = loadVersionConfig({ cwd, configPath: options.config });
      const dryRun = !options.apply;
      const force = options.force === true;
      const noLlm = options.noLlm === true;

      const targets = await resolveTargets(options, cwd, versionConfig);

      let totalReleaseCount = 0;
      const releasesByTarget: Array<{
        target: BackfillTarget;
        reconstructed: Awaited<ReturnType<typeof reconstructChangelogs>>;
      }> = [];

      // Scan all targets to count total releases and estimate cost upfront
      for (const target of targets) {
        const reconstructed = await reconstructChangelogs({
          packageName: target.packageName,
          pkgPath: target.pkgPath,
          repoUrl: target.repoUrl,
          versionPrefix: versionConfig?.versionPrefix,
          tagTemplate: versionConfig?.tagTemplate,
          packageSpecificTags: versionConfig?.packageSpecificTags,
          from: options.from,
          to: options.to,
        });

        if (reconstructed.length > 0) {
          totalReleaseCount += reconstructed.length;
          releasesByTarget.push({ target, reconstructed });
        }
      }

      // Estimate and warn about LLM cost if not in --no-llm mode and LLM is enabled
      const llmEnabled = !noLlm && notesConfig.releaseNotes?.llm;
      if (llmEnabled && totalReleaseCount > 0 && !dryRun) {
        const llmConfig = notesConfig.releaseNotes?.llm;
        const enabledTasks = countEnabledLlmTasks(llmConfig?.tasks);
        warn(
          `Estimated cost: ~${totalReleaseCount} release(s) × ${enabledTasks} LLM task(s). ` +
            `Use --no-llm to disable LLM (deterministic, zero-cost run).`,
        );
      }

      // Handle case where no releases were found across all targets
      if (releasesByTarget.length === 0) {
        info(`No matching tags found across ${targets.length} target(s).`);
        return;
      }

      for (const { target, reconstructed } of releasesByTarget) {
        const changelogs = reconstructed.map((r) => r.changelog);
        const versionOutput: VersionOutput = { dryRun, updates: [], changelogs, tags: [] };
        const input = versionOutputToChangelogInput(versionOutput);

        // versionOutputToChangelogInput stamps every version with today's date (correct for a live
        // release, wrong for a historical one). Replace it with each tag's real commit date where git
        // could resolve it; `input.packages` aligns 1:1 and in order with `reconstructed`.
        for (let i = 0; i < input.packages.length; i++) {
          const date = reconstructed[i]?.date;
          const pkg = input.packages[i];
          if (date && pkg) pkg.date = date;
        }

        // Override LLM config if --no-llm is set
        const adjustedNotesConfig = noLlm
          ? { ...notesConfig, releaseNotes: { ...notesConfig.releaseNotes, llm: undefined } }
          : notesConfig;

        // Render one version per pipeline call (single context each). The pipeline's nesting decision
        // (`detectMonorepo(cwd).isMonorepo || contexts.length > 1`) then matches the live release
        // pipeline, which also renders one package per run. Passing all versions at once would make
        // `contexts.length > 1` force nesting, so a non-monorepo backfill of 2+ versions would write to
        // <dir>/<package>/<version>.md while live releases write to <dir>/<version>.md.
        // Backfill is release-notes only — never touch the cumulative changelog. `input.packages` aligns
        // 1:1 (and in order) with `reconstructed`, so `reconstructed[i].tag` names the release to edit.
        const writtenFiles: string[] = [];
        const renderedBodies: string[] = [];
        for (const pkg of input.packages) {
          const result = await runPipeline(
            { ...input, packages: [pkg] },
            { ...adjustedNotesConfig, changelog: false },
            dryRun,
            {
              skipChangelogs: true,
            },
          );
          writtenFiles.push(...result.files);
          // The pipeline keys release notes by package name; every version here is the same package.
          renderedBodies.push(result.releaseNotes?.[target.packageName] ?? '');
        }

        info(
          `${dryRun ? '[dry-run] Would backfill' : 'Backfilled'} ${changelogs.length} version(s) of ${target.packageName}:`,
        );
        for (const c of changelogs) {
          const n = c.entries.length;
          info(`  ${c.version}  (${c.revisionRange}, ${n} entr${n === 1 ? 'y' : 'ies'})`);
        }

        if (dir) {
          if (dryRun) {
            info(`Re-run with --apply to write per-version files under ${dir}/.`);
          } else {
            success(`Wrote ${writtenFiles.length} release-notes file(s) under ${dir}/.`);
          }
        }

        if (updateReleases) {
          let updated = 0;
          let skippedNoRelease = 0;
          let skippedExisting = 0;
          let skippedHandEdited = 0;
          for (let i = 0; i < reconstructed.length; i++) {
            const tag = reconstructed[i]?.tag;
            const body = renderedBodies[i];
            if (!tag) continue;
            if (!body) {
              warn(`  ${tag}: no notes rendered, skipping release update`);
              continue;
            }
            const existingBody = getReleaseBody(tag);
            const decision = decideReleaseUpdate(existingBody, onlyMissing, force);
            if (decision.action === 'skip') {
              if (decision.reason === 'no-release') {
                warn(`  ${tag}: no GitHub release found, skipping`);
                skippedNoRelease++;
              } else if (decision.reason === 'already-backfilled') {
                info(`  ${tag}: already has releasekit notes, skipping`);
                skippedExisting++;
              } else if (decision.reason === 'hand-edited') {
                info(`  ${tag}: hand-edited release body (use --force to overwrite), skipping`);
                skippedHandEdited++;
              }
              continue;
            }
            if (dryRun) {
              info(`  ${tag}: would update release body`);
            } else {
              editReleaseBody(tag, withMarker(body));
              info(`  ${tag}: updated release body`);
            }
            updated++;
          }
          const skips = [
            skippedNoRelease > 0 ? `${skippedNoRelease} without a release` : null,
            skippedExisting > 0 ? `${skippedExisting} already backfilled` : null,
            skippedHandEdited > 0 ? `${skippedHandEdited} hand-edited` : null,
          ].filter(Boolean);
          const suffix = skips.length > 0 ? ` (skipped ${skips.join(', ')})` : '';
          if (dryRun) {
            info(`[dry-run] Would update ${updated} GitHub release body(ies)${suffix}. Re-run with --apply.`);
          } else {
            success(`Updated ${updated} GitHub release body(ies)${suffix}.`);
          }
        }
      }
    });
}

/** Count the number of enabled LLM tasks (summarize, enhance, categorize, releaseNotes). */
function countEnabledLlmTasks(tasks?: {
  summarize?: boolean;
  enhance?: boolean;
  categorize?: boolean;
  releaseNotes?: boolean;
}): number {
  if (!tasks) return 4; // All tasks enabled by default
  return Object.values(tasks).filter(Boolean).length || 4;
}

/**
 * Resolve the set of packages to backfill: every workspace package under `--all`, or a single package
 * from `--package`/`--path` (falling back to the package.json name at `--path`). Exits with a clean
 * error when discovery fails or a single package's name can't be determined.
 *
 * `--all` reuses the version stage's discovery (`VersionEngine.getWorkspacePackages`), so it finds the
 * same packages a live release would — npm/JS plus pure-Cargo crates, scoped by `config.packages` —
 * rather than just package.json workspaces. (pub-only packages aren't discovered there either; pass
 * those via `--package`.)
 */
async function resolveTargets(
  options: { all?: boolean; package?: string; path: string },
  cwd: string,
  versionConfig: VersionConfig,
): Promise<BackfillTarget[]> {
  if (options.all) {
    const { VersionEngine } = await import('@releasekit/version');
    // Minimal shape we consume — the version package's built types resolve loosely through re-exports.
    let packages: Array<{ dir: string; packageJson: { name: string; repository?: unknown } }>;
    try {
      ({ packages } = await new VersionEngine(versionConfig).getWorkspacePackages());
    } catch (err) {
      error(`Could not discover workspace packages: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }
    const targets = packages
      .filter((p) => Boolean(p.packageJson.name))
      .map((p) => ({
        packageName: p.packageJson.name,
        pkgPath: p.dir,
        repoUrl: normalizeRepoUrl((p.packageJson as { repository?: unknown }).repository) ?? null,
      }));
    if (targets.length === 0) {
      error('No workspace packages with a name were found to backfill.');
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }
    return targets;
  }

  const pkgPath = path.resolve(cwd, options.path);
  const pkgJson = readPackageJson(pkgPath);
  const packageName = options.package ?? pkgJson.name;
  if (!packageName) {
    error('Could not determine the package name. Pass --package, or run in a directory with a package.json.');
    process.exit(EXIT_CODES.GENERAL_ERROR);
  }
  return [{ packageName, pkgPath, repoUrl: pkgJson.repoUrl ?? null }];
}
