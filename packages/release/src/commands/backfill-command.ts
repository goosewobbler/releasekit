import * as fs from 'node:fs';
import * as path from 'node:path';
import type { VersionOutput } from '@releasekit/core';
import { EXIT_CODES, error, info, success, warn } from '@releasekit/core';
import { Command } from 'commander';
import semver from 'semver';
import { decideReleaseUpdate, editReleaseBody, getReleaseBody, withMarker } from '../backfill/github-release.js';
import { reconstructChangelogs } from '../backfill/reconstruct.js';

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
    let repoUrl: string | undefined;
    const repo = pkg.repository;
    if (typeof repo === 'string') repoUrl = repo;
    else if (repo?.url) repoUrl = repo.url;
    // Strip the `git+` prefix and `.git` suffix independently — a url may carry either alone
    // (e.g. `git+https://…/repo` with no suffix), and leaving the prefix breaks compare links.
    if (repoUrl?.startsWith('git+')) repoUrl = repoUrl.slice(4);
    if (repoUrl?.endsWith('.git')) repoUrl = repoUrl.slice(0, -4);
    return { name: pkg.name, repoUrl };
  } catch (err) {
    warn(`Could not parse ${file}: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}

/**
 * Backfill release notes for already-released versions of a single package by reconstructing each
 * version's notes from git history. Renders each version through the notes pipeline and writes the
 * result to per-version files (`notes.releaseNotes.file.dir`), to the matching GitHub release bodies
 * (`--update-releases`), or both. Dry-run by default. (#293 — LLM caching and the Action surface are
 * follow-ups.)
 */
export function createBackfillCommand(): Command {
  return new Command('backfill')
    .description('Regenerate release notes for already-released versions from git history')
    .option('-p, --package <name>', 'Package name (defaults to the package.json name at --path)')
    .option('--path <dir>', 'Package directory', '.')
    .option('--from <version>', 'Earliest version to backfill (inclusive)')
    .option('--to <version>', 'Latest version to backfill (inclusive)')
    .option('--update-releases', 'Update matching GitHub release bodies via `gh release edit`', false)
    .option('--only-missing', 'With --update-releases, skip releases already carrying releasekit notes', false)
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

      const { loadConfig: loadVersionConfig } = await import('@releasekit/version');
      const {
        versionOutputToChangelogInput,
        runPipeline,
        loadConfig: loadNotesConfig,
      } = await import('@releasekit/notes');

      const cwd = process.cwd();
      const pkgPath = path.resolve(cwd, options.path);
      const pkgJson = readPackageJson(pkgPath);
      const packageName: string | undefined = options.package ?? pkgJson.name;
      if (!packageName) {
        error('Could not determine the package name. Pass --package, or run in a directory with a package.json.');
        process.exit(EXIT_CODES.GENERAL_ERROR);
      }

      const updateReleases: boolean = options.updateReleases === true;
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

      const versionConfig = loadVersionConfig({ cwd, configPath: options.config });

      const reconstructed = await reconstructChangelogs({
        packageName,
        pkgPath,
        repoUrl: pkgJson.repoUrl ?? null,
        versionPrefix: versionConfig?.versionPrefix,
        tagTemplate: versionConfig?.tagTemplate,
        packageSpecificTags: versionConfig?.packageSpecificTags,
        from: options.from,
        to: options.to,
      });

      if (reconstructed.length === 0) {
        info(`No matching tags found for ${packageName}.`);
        return;
      }

      const dryRun = !options.apply;
      const changelogs = reconstructed.map((r) => r.changelog);
      const versionOutput: VersionOutput = { dryRun, updates: [], changelogs, tags: [] };
      const input = versionOutputToChangelogInput(versionOutput);

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
        const result = await runPipeline({ ...input, packages: [pkg] }, { ...notesConfig, changelog: false }, dryRun, {
          skipChangelogs: true,
        });
        writtenFiles.push(...result.files);
        // The pipeline keys release notes by package name; every version here is the same package.
        renderedBodies.push(result.releaseNotes?.[packageName] ?? '');
      }

      info(`${dryRun ? '[dry-run] Would backfill' : 'Backfilled'} ${changelogs.length} version(s) of ${packageName}:`);
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
        const onlyMissing: boolean = options.onlyMissing === true;
        let updated = 0;
        let skippedNoRelease = 0;
        let skippedExisting = 0;
        for (let i = 0; i < reconstructed.length; i++) {
          const tag = reconstructed[i]?.tag;
          const body = renderedBodies[i];
          if (!tag) continue;
          if (!body) {
            warn(`  ${tag}: no notes rendered, skipping release update`);
            continue;
          }
          const decision = decideReleaseUpdate(getReleaseBody(tag), onlyMissing);
          if (decision.action === 'skip') {
            if (decision.reason === 'no-release') {
              warn(`  ${tag}: no GitHub release found, skipping`);
              skippedNoRelease++;
            } else {
              info(`  ${tag}: already has releasekit notes, skipping`);
              skippedExisting++;
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
          skippedExisting > 0 ? `${skippedExisting} already done` : null,
        ].filter(Boolean);
        const suffix = skips.length > 0 ? ` (skipped ${skips.join(', ')})` : '';
        if (dryRun) {
          info(`[dry-run] Would update ${updated} GitHub release body(ies)${suffix}. Re-run with --apply.`);
        } else {
          success(`Updated ${updated} GitHub release body(ies)${suffix}.`);
        }
      }
    });
}
