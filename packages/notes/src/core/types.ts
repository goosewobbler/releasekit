import type { RetryOptions } from '../utils/retry.js';

export type { RetryOptions };

export type ChangelogType = 'added' | 'changed' | 'deprecated' | 'removed' | 'fixed' | 'security';

export interface ChangelogEntry {
  type: ChangelogType;
  description: string;
  issueIds?: string[];
  scope?: string;
  originalType?: string;
  breaking?: boolean;
}

export interface PackageChangelog {
  packageName: string;
  version: string;
  previousVersion: string | null;
  revisionRange: string;
  repoUrl: string | null;
  date: string;
  entries: ChangelogEntry[];
}

export type InputSource = 'version' | 'conventional-changelog' | 'git-log' | 'manual';

export interface ChangelogInput {
  source: InputSource;
  packages: PackageChangelog[];
  metadata?: {
    repoUrl?: string;
    defaultBranch?: string;
  };
}

export interface EnhancedCategory {
  name: string;
  entries: ChangelogEntry[];
}

export interface EnhancedData {
  entries: ChangelogEntry[];
  summary?: string;
  categories?: EnhancedCategory[];
  releaseNotes?: string;
}

export interface TemplateContext {
  packageName: string;
  version: string;
  previousVersion: string | null;
  date: string;
  repoUrl: string | null;
  entries: ChangelogEntry[];
  compareUrl?: string;
  enhanced?: EnhancedData;
}

export interface DocumentContext {
  project: {
    name: string;
    repoUrl?: string;
  };
  versions: TemplateContext[];
  unreleased?: TemplateContext;
  compareUrls?: Record<string, string>;
}

export interface LLMOptions {
  timeout?: number;
  maxTokens?: number;
  temperature?: number;
}

export interface ScopeRules {
  allowed?: string[];
  caseSensitive?: boolean;
  invalidScopeAction?: 'remove' | 'keep' | 'fallback';
  fallbackScope?: string;
}

export interface ScopeConfig {
  mode?: 'restricted' | 'packages' | 'none' | 'unrestricted';
  rules?: ScopeRules;
}

export interface LLMPromptOverrides {
  enhance?: string;
  categorize?: string;
  enhanceAndCategorize?: string;
  summarize?: string;
  releaseNotes?: string;
}

export interface LLMPromptsConfig {
  instructions?: LLMPromptOverrides;
  templates?: LLMPromptOverrides;
}

export interface LLMCategory {
  name: string;
  description: string;
  scopes?: string[];
}

export interface LLMConfig {
  provider: string;
  model: string;
  baseURL?: string;
  apiKey?: string;
  options?: LLMOptions;
  concurrency?: number;
  retry?: RetryOptions;
  tasks?: {
    summarize?: boolean;
    enhance?: boolean;
    categorize?: boolean;
    releaseNotes?: boolean;
  };
  categories?: LLMCategory[];
  style?: string;
  scopes?: ScopeConfig;
  prompts?: LLMPromptsConfig;
}

export type OutputFormat = 'markdown' | 'github-release' | 'json';

export interface OutputConfig {
  format: OutputFormat;
  file?: string;
  options?: Record<string, unknown>;
  templates?: TemplateConfig;
}

export type MonorepoMode = 'root' | 'packages' | 'both';

export interface MonorepoConfig {
  mode?: MonorepoMode;
  rootPath?: string;
  packagesPath?: string;
}

export type UpdateStrategy = 'prepend' | 'regenerate';

export type TemplateEngine = 'handlebars' | 'liquid' | 'ejs';

export interface TemplateConfig {
  path?: string;
  engine?: TemplateEngine;
}

export interface Config {
  input?: {
    source?: string;
    file?: string;
  };
  output: OutputConfig[];
  monorepo?: MonorepoConfig;
  templates?: TemplateConfig;
  llm?: LLMConfig;
  updateStrategy?: UpdateStrategy;
}

export interface CompleteOptions {
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
}
