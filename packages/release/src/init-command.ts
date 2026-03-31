import * as fs from 'node:fs';
import { EXIT_CODES, error, info, success } from '@releasekit/core';
import { detectMonorepo } from '@releasekit/notes';
import { Command } from 'commander';

export function createInitCommand(): Command {
  return new Command('init')
    .description('Create a default releasekit.config.json')
    .option('-f, --force', 'Overwrite existing config')
    .action((options) => {
      const configPath = 'releasekit.config.json';

      if (fs.existsSync(configPath) && !options.force) {
        error(`Config file already exists at ${configPath}. Use --force to overwrite.`);
        process.exit(EXIT_CODES.GENERAL_ERROR);
      }

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
            access: 'public',
          },
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
      success(`Created ${configPath}`);
    });
}
