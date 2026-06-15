import * as fs from 'node:fs';
import * as path from 'node:path';
import type { VersionOutput } from '@releasekit/core';
import { EXIT_CODES, error, info, success } from '@releasekit/core';
import { Command } from 'commander';
import { reconstructChangelogs } from '../backfill/reconstruct.js';

function readPackageJson(pkgPath: string): { name?: string; repoUrl?: string } {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgPath, 'package.json'), 'utf-8'));
    let repoUrl: string | undefined;
    const repo = pkg.repository;
    if (typeof repo === 'string') repoUrl = repo;
    else if (repo?.url) repoUrl = repo.url;
    if (repoUrl?.startsWith('git+') && repoUrl.endsWith('.git')) repoUrl = repoUrl.slice(4, -4);
    return { name: pkg.name, repoUrl };
  } catch {
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
      // Backfill is release-notes only — never touch the cumulative changelog.
      const result = await runPipeline(input, { ...notesConfig, changelog: false }, dryRun, { skipChangelogs: true });

      info(`${dryRun ? '[dry-run] Would backfill' : 'Backfilled'} ${changelogs.length} version(s) of ${packageName}:`);
      for (const c of changelogs) {
        const n = c.entries.length;
        info(`  ${c.version}  (${c.revisionRange}, ${n} entr${n === 1 ? 'y' : 'ies'})`);
      }
      if (dryRun) {
        info(`Re-run with --apply to write per-version files under ${dir}/.`);
      } else {
        success(`Wrote ${result.files.length} release-notes file(s) under ${dir}/.`);
      }
    });
}
