import type { MonorepoConfig } from '@releasekit/config';
import type { ChangelogRefsMode } from '@releasekit/core';
import type { RetryOptions } from '../utils/retry.js';

export type { RetryOptions };

export type ChangelogType = 'added' | 'changed' | 'deprecated' | 'removed' | 'fixed' | 'security';

export interface PRContext {
  number: number;
  title: string;
  body: string;
}

export interface ChangelogEntry {
  type: ChangelogType;
  description: string;
  issueIds?: string[];
  scope?: string;
  originalType?: string;
  breaking?: boolean;
  leadIn?: string;
  /** Populated upstream of LLM tasks; never serialised to disk. */
  context?: { prs: PRContext[] };
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
  /** True when `previousVersion === null` — the package has no prior release. Templates can branch
   *  on it to add a first-release intro; the default renderer seeds a placeholder line. */
  isFirstRelease?: boolean;
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
  /** Which release-notes destination this render targets: `'file'` (an in-repo per-version file)
   *  or `'release'` (the GitHub release body). Templates can branch on it — e.g. emit docs-site
   *  YAML frontmatter only for `'file'`, since it would render as literal text in a GitHub release. */
  output?: 'file' | 'release';
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
  invalidScopeAction?: 'remove' | 'keep' | 'fallback';
  fallbackScope?: string;
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
  context?: {
    pullRequests?: boolean;
  };
  examples?: number;
  categoryOrder?: string[];
  cache?: boolean;
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
  /** How bare `#NNN` issue/PR refs render in the changelog (#499). Default `'link'` when unset. */
  refs?: ChangelogRefsMode;
}

export interface LinksConfig {
  items?: Array<{ label: string; url: string }>;
  fromPRBodyMarker?: string;
  title?: string;
}

export interface ReleaseNotesFileConfig {
  /** Directory for the per-version release-notes files (default: release-notes). */
  dir?: string;
}

export interface FirstReleaseConfig {
  /** Placeholder intro line for a package's first release. Supports ${packageName} and ${version}. */
  text?: string;
}

export interface ReleaseNotesConfig {
  /** In-repo per-version file output. Omit to keep notes only on the GitHub release body. */
  file?: ReleaseNotesFileConfig;
  templates?: TemplateConfig;
  llm?: LLMConfig;
  links?: LinksConfig;
  /** First-release placeholder intro. Default-on with a factual line; set to false to disable. */
  firstRelease?: false | FirstReleaseConfig;
}
