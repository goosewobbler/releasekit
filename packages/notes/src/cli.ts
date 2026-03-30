#!/usr/bin/env node
import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveAuth } from '@releasekit/config';
import {
  EXIT_CODES,
  error,
  info,
  readPackageVersion,
  setLogLevel,
  setQuietMode,
  success,
  warn,
} from '@releasekit/core';
import { Command } from 'commander';
import { runPipeline } from './core/pipeline.js';
import { getExitCode, NotesError } from './errors/index.js';
import { parseVersionOutput } from './input/version-output.js';
import { detectMonorepo } from './monorepo/aggregator.js';

export function createNotesCommand(): Command {
  const cmd = new Command('notes').description(
    'Generate changelogs with LLM-powered enhancement and flexible templating',
  );

  cmd
    .command('generate', { isDefault: true })
    .description('Generate changelog from input data')
    .option('-i, --input <file>', 'Input file (default: stdin)')
    .option('--no-changelog', 'Disable changelog generation')
    .option('--changelog-mode <mode>', 'Changelog location mode (root|packages|both)')
    .option('--changelog-file <name>', 'Changelog file name override')
    .option('--release-notes-mode <mode>', 'Enable release notes and set location (root|packages|both)')
    .option('--release-notes-file <name>', 'Release notes file name override')
    .option('--no-release-notes', 'Disable release notes generation')
    .option('-t, --template <path>', 'Template file or directory')
    .option('-e, --engine <engine>', 'Template engine (handlebars|liquid|ejs)')
    .option('--monorepo <mode>', 'Monorepo mode (root|packages|both)')
    .option('--llm-provider <provider>', 'LLM provider')
    .option('--llm-model <model>', 'LLM model')
    .option('--llm-base-url <url>', 'LLM base URL (for openai-compatible provider)')
    .option('--llm-tasks <tasks>', 'Comma-separated LLM tasks')
    .option('--no-llm', 'Disable LLM processing')
    .option('--target <package>', 'Filter to a specific package name')
    .option('--config <path>', 'Config file path')
    .option('--regenerate', 'Regenerate entire changelog instead of prepending new entries')
    .option('--dry-run', 'Preview without writing')
    .option('-v, --verbose', 'Increase verbosity', increaseVerbosity, 0)
    .option('-q, --quiet', 'Suppress non-error output')
    .action(async (options) => {
      setVerbosity(options.verbose);
      if (options.quiet) setQuietMode(true);

      try {
        const loadedConfig = loadConfig({ cwd: process.cwd(), configPath: options.config });
        const config: import('./core/types.js').Config = loadedConfig?.notes ?? {};

        if (options.changelog === false) {
          config.changelog = false;
        } else if (options.changelogMode || options.changelogFile) {
          const existing = config.changelog !== false ? (config.changelog ?? {}) : {};
          config.changelog = {
            ...existing,
            ...(options.changelogMode ? { mode: options.changelogMode as 'root' | 'packages' | 'both' } : {}),
            ...(options.changelogFile
              ? {
                  mode: ((config.changelog as { mode?: string })?.mode ?? 'root') as 'root' | 'packages' | 'both',
                  file: options.changelogFile,
                }
              : {}),
          };
        }

        if (options.releaseNotes === false) {
          config.releaseNotes = false;
        } else if (options.releaseNotesMode || options.releaseNotesFile) {
          const existing = config.releaseNotes !== false ? (config.releaseNotes ?? {}) : {};
          config.releaseNotes = {
            ...existing,
            ...(options.releaseNotesMode ? { mode: options.releaseNotesMode } : {}),
            ...(options.releaseNotesFile
              ? {
                  mode: existing.mode ?? 'root',
                  file: options.releaseNotesFile,
                }
              : {}),
          };
        }

        if (config.changelog === false && (options.template || options.engine)) {
          const ignored = [options.template && '--template', options.engine && '--engine']
            .filter(Boolean)
            .join(' and ');
          warn(`${ignored} ignored: changelog is disabled via --no-changelog`);
        }

        if (options.template && config.changelog !== false) {
          const existing = config.changelog ?? {};
          config.changelog = {
            ...existing,
            templates: { ...existing.templates, path: options.template },
          };
        }

        if (options.engine && config.changelog !== false) {
          const existing = config.changelog ?? {};
          config.changelog = {
            ...existing,
            templates: { ...existing.templates, engine: options.engine as 'handlebars' | 'liquid' | 'ejs' },
          };
        }

        if (options.regenerate) {
          config.updateStrategy = 'regenerate';
        }

        if (options.llm === false) {
          info('LLM processing disabled via --no-llm flag');
          if (config.releaseNotes && typeof config.releaseNotes !== 'boolean') {
            config.releaseNotes = { ...config.releaseNotes, llm: undefined };
          }
        } else if (options.llmProvider || options.llmModel || options.llmBaseUrl || options.llmTasks) {
          const existingRn = typeof config.releaseNotes === 'object' ? config.releaseNotes : {};
          const existingLlm = existingRn.llm;
          const llm = {
            provider: existingLlm?.provider ?? 'openai-compatible',
            model: existingLlm?.model ?? '',
            ...(existingLlm ?? {}),
          };
          if (options.llmProvider) llm.provider = options.llmProvider;
          if (options.llmModel) llm.model = options.llmModel;
          if (options.llmBaseUrl) llm.baseURL = options.llmBaseUrl;
          if (options.llmTasks) {
            const taskNames = (options.llmTasks as string).split(',').map((t: string) => t.trim());
            llm.tasks = {
              enhance: taskNames.includes('enhance'),
              summarize: taskNames.includes('summarize'),
              categorize: taskNames.includes('categorize'),
              releaseNotes: taskNames.includes('release-notes') || taskNames.includes('releaseNotes'),
            };
          }

          config.releaseNotes = {
            ...existingRn,
            llm: llm as import('./core/types.js').LLMConfig,
          };

          info(`LLM configured: ${llm.provider}${llm.model ? ` (${llm.model})` : ''}`);
          if (llm.baseURL) {
            info(`LLM base URL: ${llm.baseURL}`);
          }
          const taskList = Object.entries(llm.tasks || {})
            .filter(([, enabled]) => enabled)
            .map(([name]) => name)
            .join(', ');
          if (taskList) {
            info(`LLM tasks: ${taskList}`);
          }
        }

        let inputJson: string;

        if (options.input) {
          inputJson = fs.readFileSync(options.input, 'utf-8');
        } else {
          inputJson = await readStdin();
        }

        const input = parseVersionOutput(inputJson);

        if (options.target) {
          const before = input.packages.length;
          input.packages = input.packages.filter((p) => p.packageName === options.target);
          if (input.packages.length === 0) {
            info(`No changelog found for package "${options.target}" (had ${before} package(s))`);
            return;
          }
          info(`Filtered to package: ${options.target}`);
        }

        if (options.monorepo) {
          config.monorepo = { ...config.monorepo, mode: options.monorepo as 'root' | 'packages' | 'both' };
        }

        await runPipeline(input, config, options.dryRun ?? false);

        if (options.dryRun) {
          info('Dry run complete - no files were written');
        } else {
          success('Changelog generation complete');
        }
      } catch (err) {
        handleError(err);
      }
    });

  cmd
    .command('init')
    .description('Create default configuration file')
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
      };

      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
      success(`Created config file at ${configPath}`);
    });

  cmd
    .command('auth <provider>')
    .description('Configure API key for an LLM provider')
    .option('--key <key>', 'API key (omit to be prompted)')
    .action(async (provider: string, options) => {
      let apiKey: string;

      if (options.key) {
        apiKey = options.key;
      } else {
        apiKey = await promptSecret(`Enter API key for ${provider}: `);
      }

      if (!apiKey.trim()) {
        error('API key cannot be empty');
        process.exit(EXIT_CODES.GENERAL_ERROR);
      }

      saveAuth(provider, apiKey.trim());
      success(`API key saved for ${provider}`);
    });

  cmd
    .command('providers')
    .description('List available LLM providers')
    .action(() => {
      info('Available LLM providers:');
      console.log('  openai          - OpenAI (GPT models)');
      console.log('  anthropic       - Anthropic (Claude models)');
      console.log('  ollama          - Ollama (local models)');
      console.log('  openai-compatible - Any OpenAI-compatible endpoint');
    });

  return cmd;
}

function increaseVerbosity(_: string, previous: number): number {
  return previous + 1;
}

function setVerbosity(level: number): void {
  const levels = ['info', 'debug', 'trace'] as const;
  setLogLevel(levels[Math.min(level, levels.length - 1)] ?? 'info');
}

async function readStdin(): Promise<string> {
  const chunks: string[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  return chunks.join('');
}

function promptSecret(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function handleError(err: unknown): void {
  if (err instanceof NotesError) {
    err.logError();
    process.exit(getExitCode(err));
  }

  error(err instanceof Error ? err.message : String(err));
  process.exit(EXIT_CODES.GENERAL_ERROR);
}

const isMain = (() => {
  try {
    return process.argv[1] ? fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url) : false;
  } catch {
    return false;
  }
})();

if (isMain) {
  createNotesCommand()
    .name('releasekit-notes')
    .version(readPackageVersion(import.meta.url))
    .parse();
}
