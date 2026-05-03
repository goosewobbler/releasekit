import type { MonorepoConfig } from '@releasekit/config';
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
  leadIn?: string;
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
  /** True when rendered for a single-package inline context (e.g. GitHub release body).
   *  Templates can use this to suppress document-level headings that are redundant
   *  when the content is embedded in a release that already shows the package/version. */
  perPackage?: boolean;
}

export interface LLMOptions {
  timeout?: number;
  maxTokens?: number;
  temperature?: number;
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
}

export interface LLMCategory {
  name: string;
  description: string;
  scopes?: string[];
}

export interface ScopeRules {
  allowed?: string[];
  caseSensitive?: boolean;
}

export interface ScopeConfig {
  mode?: 'restricted' | 'packages' | 'none' | 'unrestricted';
  rules?: ScopeRules;
}

export type UpdateStrategy = 'prepend' | 'regenerate';

export interface Config {
  changelog?: false | ChangelogConfig;
  releaseNotes?: false | ReleaseNotesConfig;
  monorepo?: MonorepoConfig;
  updateStrategy?: UpdateStrategy;
}

export type JSONSchema = Record<string, unknown>;

export interface CompleteOptions {
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
  schema?: JSONSchema;
  toolName?: string;
}

export type TemplateEngine = 'handlebars' | 'liquid' | 'ejs';

export interface TemplateConfig {
  path?: string;
  engine?: TemplateEngine;
}

export interface LLMConfig {
  provider: string;
  model: string;
  baseURL?: string;
  apiKey?: string;
  options?: {
    timeout?: number;
    maxTokens?: number;
    temperature?: number;
  };
  concurrency?: number;
  retry?: RetryOptions;
  tasks?: {
    summarize?: boolean;
    enhance?: boolean;
    categorize?: boolean;
    releaseNotes?: boolean;
  };
  examples: number;
  categories?: Array<{ name: string; description: string; scopes?: string[] }>;
  style?: string;
  scopes?: ScopeConfig;
  prompts?: {
    instructions?: Record<string, string>;
  };
}

export type LocationMode = 'root' | 'packages' | 'both';

export interface ChangelogConfig {
  mode?: LocationMode;
  file?: string;
  templates?: TemplateConfig;
}

export interface ReleaseNotesConfig {
  mode?: LocationMode;
  file?: string;
  templates?: TemplateConfig;
  llm?: LLMConfig;
}
