import {
  EXIT_CODES,
  runPreview,
  runRelease
} from "./chunk-6UI4L62T.js";
import {
  init_esm_shims
} from "./chunk-NOZSTVTV.js";

// src/preview-command.ts
init_esm_shims();
import { Command } from "commander";
function createPreviewCommand() {
  return new Command("preview").description("Post a release preview comment on the current pull request").option("-c, --config <path>", "Path to config file").option("--project-dir <path>", "Project directory", process.cwd()).option("--pr <number>", "PR number (auto-detected from GitHub Actions)").option("--repo <owner/repo>", "Repository (auto-detected from GITHUB_REPOSITORY)").option("-p, --prerelease [identifier]", "Force prerelease preview (auto-detected by default)").option("--stable", "Force stable release preview (graduation from prerelease)", false).option(
    "-d, --dry-run",
    "Print the comment to stdout without posting (GitHub context not available in dry-run mode)",
    false
  ).action(async (opts) => {
    try {
      await runPreview({
        config: opts.config,
        projectDir: opts.projectDir,
        pr: opts.pr,
        repo: opts.repo,
        prerelease: opts.prerelease,
        stable: opts.stable,
        dryRun: opts.dryRun
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }
  });
}

// src/release-command.ts
init_esm_shims();
import { Command as Command2, Option } from "commander";
function createReleaseCommand() {
  return new Command2("release").description("Run the full release pipeline").option("-c, --config <path>", "Path to config file").option("-d, --dry-run", "Preview all steps without side effects", false).option("-b, --bump <type>", "Force bump type (patch|minor|major)").option("-p, --prerelease [identifier]", "Create prerelease version").option("-s, --sync", "Use synchronized versioning across all packages", false).option("-t, --target <packages>", "Target specific packages (comma-separated)").option("--branch <name>", "Override the git branch used for push").addOption(new Option("--npm-auth <method>", "NPM auth method").choices(["auto", "oidc", "token"]).default("auto")).option("--skip-notes", "Skip changelog generation", false).option("--skip-publish", "Skip registry publishing and git operations", false).option("--skip-git", "Skip git commit/tag/push", false).option("--skip-github-release", "Skip GitHub release creation", false).option("--skip-verification", "Skip post-publish verification", false).option("-j, --json", "Output results as JSON", false).option("-v, --verbose", "Verbose logging", false).option("-q, --quiet", "Suppress non-error output", false).option("--project-dir <path>", "Project directory", process.cwd()).action(async (opts) => {
    const options = {
      config: opts.config,
      dryRun: opts.dryRun,
      bump: opts.bump,
      prerelease: opts.prerelease,
      sync: opts.sync,
      target: opts.target,
      branch: opts.branch,
      npmAuth: opts.npmAuth,
      skipNotes: opts.skipNotes,
      skipPublish: opts.skipPublish,
      skipGit: opts.skipGit,
      skipGithubRelease: opts.skipGithubRelease,
      skipVerification: opts.skipVerification,
      json: opts.json,
      verbose: opts.verbose,
      quiet: opts.quiet,
      projectDir: opts.projectDir
    };
    try {
      const result = await runRelease(options);
      if (options.json && result) {
        console.log(JSON.stringify(result, null, 2));
      }
      if (!result) {
        process.exit(0);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }
  });
}

export {
  createPreviewCommand,
  createReleaseCommand
};
