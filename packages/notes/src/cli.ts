#!/usr/bin/env node
import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { error, info, setLogLevel, setQuietMode, success } from '@releasekit/core';
import { Command } from 'commander';
import { getDefaultConfig, loadConfig, saveAuth } from './core/config.js';
import { createTemplateContext, runPipeline } from './core/pipeline.js';
import type { OutputConfig } from './core/types.js';
import { EXIT_CODES, getExitCode, NotesError } from './errors/index.js';
import { parsePackageVersioner } from './input/package-versioner.js';
import { detectMonorepo, writeMonorepoChangelogs } from './monorepo/index.js';

const program = new Command();

program
  .name('releasekit-notes')
  .description('Generate changelogs with LLM-powered enhancement and flexible templating')
  .version('0.1.0');

program
  .command('generate', { isDefault: true })
  .description('Generate changelog from input data')
  .option('-i, --input <file>', 'Input file (default: stdin)')
  .option('-o, --output <spec>', 'Output spec (format:file)', collectOutputs, [] as OutputConfig[])
  .option('-t, --template <path>', 'Template file or directory')
  .option('-e, --engine <engine>', 'Template engine (handlebars|liquid|ejs)')
  .option('--monorepo <mode>', 'Monorepo mode (root|packages|both)')
  .option('--llm-provider <provider>', 'LLM provider')
  .option('--llm-model <model>', 'LLM model')
  .option('--llm-base-url <url>', 'LLM base URL (for openai-compatible provider)')
  .option('--llm-tasks <tasks>', 'Comma-separated LLM tasks')
  .option('--no-llm', 'Disable LLM processing')
  .option('--config <path>', 'Config file path')
  .option('--dry-run', 'Preview without writing')
  .option('--regenerate', 'Regenerate entire changelog')
  .option('-v, --verbose', 'Increase verbosity', increaseVerbosity, 0)
  .option('-q, --quiet', 'Suppress non-error output')
  .action(async (options) => {
    setVerbosity(options.verbose);
    if (options.quiet) setQuietMode(true);

    try {
      const config = loadConfig(process.cwd(), options.config);

      if (options.output.length > 0) {
        config.output = options.output;
      }

      if (config.output.length === 0) {
        config.output = getDefaultConfig().output;
      }

      if (options.regenerate) {
        config.updateStrategy = 'regenerate';
      }

      if (options.template) {
        config.templates = { ...config.templates, path: options.template };
      }

      if (options.engine) {
        config.templates = { ...config.templates, engine: options.engine };
      }

      if (options.llm === false) {
        info('LLM processing disabled via --no-llm flag');
        delete config.llm;
      } else if (options.llmProvider || options.llmModel || options.llmBaseUrl || options.llmTasks) {
        config.llm = config.llm ?? { provider: 'openai-compatible', model: '' };
        if (options.llmProvider) config.llm.provider = options.llmProvider;
        if (options.llmModel) config.llm.model = options.llmModel;
        if (options.llmBaseUrl) config.llm.baseURL = options.llmBaseUrl;
        if (options.llmTasks) {
          const taskNames = (options.llmTasks as string).split(',').map((t: string) => t.trim());
          config.llm.tasks = {
            enhance: taskNames.includes('enhance'),
            summarize: taskNames.includes('summarize'),
            categorize: taskNames.includes('categorize'),
            releaseNotes: taskNames.includes('release-notes') || taskNames.includes('releaseNotes'),
          };
        }
        info(`LLM configured: ${config.llm.provider}${config.llm.model ? ` (${config.llm.model})` : ''}`);
        if (config.llm.baseURL) {
          info(`LLM base URL: ${config.llm.baseURL}`);
        }
        const taskList = Object.entries(config.llm.tasks || {})
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

      const input = parsePackageVersioner(inputJson);

      if (options.monorepo || config.monorepo) {
        const monorepoMode = options.monorepo ?? config.monorepo?.mode ?? 'both';
        const detected = detectMonorepo(process.cwd());

        if (!detected.isMonorepo) {
          info('No monorepo detected, using single package mode');
          await runPipeline(input, config, options.dryRun ?? false);
        } else {
          info(`Monorepo detected with packages at ${detected.packagesPath}`);
          const contexts = input.packages.map(createTemplateContext);
          writeMonorepoChangelogs(
            contexts,
            {
              rootPath: config.monorepo?.rootPath ?? process.cwd(),
              packagesPath: config.monorepo?.packagesPath ?? detected.packagesPath,
              mode: monorepoMode as 'root' | 'packages' | 'both',
            },
            config,
            options.dryRun ?? false,
          );
        }
      } else {
        await runPipeline(input, config, options.dryRun ?? false);
      }

      if (options.dryRun) {
        info('Dry run complete - no files were written');
      } else {
        success('Changelog generation complete');
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('init')
  .description('Create default configuration file')
  .option('-f, --force', 'Overwrite existing config')
  .action((options) => {
    const configPath = 'releasekit.config.json';

    if (fs.existsSync(configPath) && !options.force) {
      error(`Config file already exists at ${configPath}. Use --force to overwrite.`);
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }

    const defaultConfig = {
      $schema: 'https://releasekit.dev/schema.json',
      notes: {
        output: [{ format: 'markdown', file: 'CHANGELOG.md' }],
        updateStrategy: 'prepend',
      },
    };

    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    success(`Created config file at ${configPath}`);
  });

program
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

program
  .command('providers')
  .description('List available LLM providers')
  .action(() => {
    info('Available LLM providers:');
    console.log('  openai          - OpenAI (GPT models)');
    console.log('  anthropic       - Anthropic (Claude models)');
    console.log('  ollama          - Ollama (local models)');
    console.log('  openai-compatible - Any OpenAI-compatible endpoint');
  });

function collectOutputs(value: string, previous: OutputConfig[]): OutputConfig[] {
  const parts = value.split(':');
  const format = (parts[0] ?? 'markdown') as OutputConfig['format'];
  const file = parts[1];
  const spec: OutputConfig = { format };

  if (file) {
    spec.file = file;
  }

  return [...previous, spec];
}

function increaseVerbosity(_: string, previous: number): number {
  return previous + 1;
}

function setVerbosity(level: number): void {
  // 0 = info (default), 1 = debug (-v), 2 = trace (-vv)
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

program.parse();
