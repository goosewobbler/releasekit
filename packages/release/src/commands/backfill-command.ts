import * as fs from 'node:fs';
import * as path from 'node:path';
import type { VersionOutput } from '@releasekit/core';
import { EXIT_CODES, error, info, success, warn } from '@releasekit/core';
import { Command } from 'commander';
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
    if (repoUrl?.startsWith('git+') && repoUrl.endsWith('.git')) repoUrl = repoUrl.slice(4, -4);
    return { name: pkg.name, repoUrl };
  } catch (err) {
    warn(`Could not parse ${file}: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}

/**
 * Backfill release notes for already-released versions of a single package by reconstructing each
 * version's notes from git history and running them through the notes pipeline's per-version file
 * output. Dry-run by default. (#293 — tracer slice; gh-release-edit, --only-missing, LLM caching and
 * the Action surface are follow-ups.)
 */
export function createBackfillCommand(): Command {
  return new Command('backfill')
    .description('Regenerate release notes for already-released versions from git history')
    .option('-p, --package <name>', 'Package name (defaults to the package.json name at --path)')
    .option('--path <dir>', 'Package directory', '.')
    .option('--from <version>', 'Earliest version to backfill (inclusive)')
    .option('--to <version>', 'Latest version to backfill (inclusive)')
    .option('--apply', 'Write files (default: dry-run preview)', false)
    .option('-c, --config <path>', 'Config file path')
    .action(async (options) => {
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

      const notesConfig = loadNotesConfig(cwd, options.config);
      const dir = notesConfig.releaseNotes !== false ? notesConfig.releaseNotes?.file?.dir : undefined;
      if (!dir) {
        error('Backfill writes per-version files — set notes.releaseNotes.file.dir in your config first.');
        process.exit(EXIT_CODES.GENERAL_ERROR);
      }

      const versionConfig = loadVersionConfig({ cwd, configPath: options.config });

      const changelogs = await reconstructChangelogs({
        packageName,
        pkgPath,
        repoUrl: pkgJson.repoUrl ?? null,
        versionPrefix: versionConfig?.versionPrefix,
        tagTemplate: versionConfig?.tagTemplate,
        packageSpecificTags: versionConfig?.packageSpecificTags,
        from: options.from,
        to: options.to,
      });

      if (changelogs.length === 0) {
        info(`No matching tags found for ${packageName}.`);
        return;
      }

      const dryRun = !options.apply;
      const versionOutput: VersionOutput = { dryRun, updates: [], changelogs, tags: [] };
      const input = versionOutputToChangelogInput(versionOutput);

      // Render one version per pipeline call (single context each). The pipeline's nesting decision
      // (`detectMonorepo(cwd).isMonorepo || contexts.length > 1`) then matches the live release
      // pipeline, which also renders one package per run. Passing all versions at once would make
      // `contexts.length > 1` force nesting, so a non-monorepo backfill of 2+ versions would write to
      // <dir>/<package>/<version>.md while live releases write to <dir>/<version>.md.
      // Backfill is release-notes only — never touch the cumulative changelog.
      const writtenFiles: string[] = [];
      for (const pkg of input.packages) {
        const result = await runPipeline({ ...input, packages: [pkg] }, { ...notesConfig, changelog: false }, dryRun, {
          skipChangelogs: true,
        });
        writtenFiles.push(...result.files);
      }

      info(`${dryRun ? '[dry-run] Would backfill' : 'Backfilled'} ${changelogs.length} version(s) of ${packageName}:`);
      for (const c of changelogs) {
        const n = c.entries.length;
        info(`  ${c.version}  (${c.revisionRange}, ${n} entr${n === 1 ? 'y' : 'ies'})`);
      }
      if (dryRun) {
        info(`Re-run with --apply to write per-version files under ${dir}/.`);
      } else {
        success(`Wrote ${writtenFiles.length} release-notes file(s) under ${dir}/.`);
      }
    });
}
