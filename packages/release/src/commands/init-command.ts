import * as fs from 'node:fs';
import { EXIT_CODES, error, info, success } from '@releasekit/core';
import { detectMonorepo } from '@releasekit/notes';
import { Command } from 'commander';
import { runLabelsSync } from './labels-command.js';

const CI_GUIDE_URL = 'https://goosewobbler.github.io/releasekit/ci-setup';

function printNextSteps(): void {
  info('');
  info('Next steps:');
  info('  1. Create the labels ReleaseKit relies on:  releasekit labels sync');
  info('  2. Preview a release without publishing:     releasekit --dry-run');
  info(`  3. Wire up CI — see the setup guide:          ${CI_GUIDE_URL}`);
}

export function createInitCommand(): Command {
  return new Command('init')
    .description('Create a default releasekit.config.json')
    .option('-f, --force', 'Overwrite existing config')
    .option('--labels', 'Also run `labels sync` to create the required GitHub labels (requires a GitHub token)', false)
    .action(async (options) => {
      const configPath = 'releasekit.config.json';

      if (fs.existsSync(configPath) && !options.force) {
        error(`Config file already exists at ${configPath}. Use --force to overwrite.`);
        process.exit(EXIT_CODES.GENERAL_ERROR);
      } else {
        let changelogMode: 'root' | 'packages' | 'both';
        try {
          const detected = detectMonorepo(process.cwd());
          changelogMode = detected.isMonorepo ? 'packages' : 'root';
          info(
            detected.isMonorepo
              ? 'Monorepo detected — using mode: packages'
              : 'Single-package repo detected — using mode: root',
          );
        } catch {
          changelogMode = 'root';
          info('Could not detect project type — using mode: root');
        }

        let packageName: string | undefined;
        try {
          const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8')) as { name?: string };
          packageName = pkg.name;
        } catch {
          // no package.json or unreadable — omit access
        }
        const isScoped = packageName?.startsWith('@') ?? false;

        const defaultConfig = {
          $schema: 'https://goosewobbler.github.io/releasekit/schema.json',
          notes: {
            changelog: {
              mode: changelogMode,
            },
          },
          publish: {
            npm: {
              enabled: true,
              ...(isScoped ? { access: 'public' } : {}),
            },
          },
        };

        fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
        success(`Created ${configPath}`);

        // --labels is opt-in sugar: init stays a local generator unless the user explicitly
        // asks for the remote label setup. Run it now if a token is present; otherwise fall
        // through to the next-steps epilogue so the manual command is always surfaced.
        if (options.labels) {
          try {
            await runLabelsSync({ config: undefined, projectDir: process.cwd() });
            return;
          } catch (err) {
            error(`Could not sync labels: ${err instanceof Error ? err.message : String(err)}`);
            info('Run `releasekit labels sync` once a GitHub token is available.');
          }
        }

        printNextSteps();
      }
    });
}
