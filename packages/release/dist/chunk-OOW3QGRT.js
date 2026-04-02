import {
  require_semver
} from "./chunk-PJO2QZSV.js";
import {
  __toESM
} from "./chunk-QGM4M3NI.js";

// ../publish/dist/chunk-OZHNJUFW.js
import chalk from "chalk";
import * as fs2 from "fs";
var import_semver = __toESM(require_semver(), 1);
import * as TOML from "smol-toml";
import * as fs3 from "fs";
import * as path3 from "path";
import { z as z2 } from "zod";
import { z } from "zod";
import * as fs22 from "fs";
import * as os from "os";
import * as path22 from "path";
import { execFile } from "child_process";
import * as fs4 from "fs";
import * as TOML2 from "smol-toml";
import * as fs5 from "fs";
import * as path4 from "path";
import * as fs6 from "fs";
import * as path5 from "path";
import * as path6 from "path";
import * as fs8 from "fs";
import * as path8 from "path";
import * as fs7 from "fs";
import * as os2 from "os";
import * as path7 from "path";
import * as fs9 from "fs";
import * as path9 from "path";
import * as fs10 from "fs";
import { z as z3 } from "zod";
import { Command } from "commander";
var LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4
};
var PREFIXES = {
  error: "[ERROR]",
  warn: "[WARN]",
  info: "[INFO]",
  debug: "[DEBUG]",
  trace: "[TRACE]"
};
var COLORS = {
  error: chalk.red,
  warn: chalk.yellow,
  info: chalk.blue,
  debug: chalk.gray,
  trace: chalk.dim
};
var currentLevel = "info";
var quietMode = false;
function setLogLevel(level) {
  currentLevel = level;
}
function setJsonMode(_json) {
}
function shouldLog(level) {
  if (quietMode && level !== "error") return false;
  return LOG_LEVELS[level] <= LOG_LEVELS[currentLevel];
}
function log(message, level = "info") {
  if (!shouldLog(level)) return;
  const formatted = COLORS[level](`${PREFIXES[level]} ${message}`);
  console.error(formatted);
}
function warn(message) {
  log(message, "warn");
}
function info(message) {
  log(message, "info");
}
function success(message) {
  if (!shouldLog("info")) return;
  console.error(chalk.green(`[SUCCESS] ${message}`));
}
function debug(message) {
  log(message, "debug");
}
var ReleaseKitError = class _ReleaseKitError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
  logError() {
    log(this.message, "error");
    if (this.suggestions.length > 0) {
      log("\nSuggested solutions:", "info");
      for (const [i, suggestion] of this.suggestions.entries()) {
        log(`${i + 1}. ${suggestion}`, "info");
      }
    }
  }
  static isReleaseKitError(error2) {
    return error2 instanceof _ReleaseKitError;
  }
};
var EXIT_CODES = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  CONFIG_ERROR: 2,
  INPUT_ERROR: 3,
  TEMPLATE_ERROR: 4,
  LLM_ERROR: 5,
  GITHUB_ERROR: 6,
  GIT_ERROR: 7,
  VERSION_ERROR: 8,
  PUBLISH_ERROR: 9
};
function sanitizePackageName(name) {
  return name.startsWith("@") ? name.slice(1).replace(/\//g, "-") : name;
}
function parseCargoToml(cargoPath) {
  const content = fs2.readFileSync(cargoPath, "utf-8");
  return TOML.parse(content);
}
var ConfigError = class extends ReleaseKitError {
  code = "CONFIG_ERROR";
  suggestions;
  constructor(message, suggestions) {
    super(message);
    this.suggestions = suggestions ?? [
      "Check that releasekit.config.json exists and is valid JSON",
      "Run with --verbose for more details"
    ];
  }
};
function mergeGitConfig(topLevel, packageLevel) {
  if (!topLevel && !packageLevel) return void 0;
  const base = topLevel ?? {
    remote: "origin",
    branch: "main",
    pushMethod: "auto"
  };
  if (!packageLevel) return base;
  return {
    remote: packageLevel.remote ?? base.remote,
    branch: packageLevel.branch ?? base.branch,
    pushMethod: packageLevel.pushMethod ?? base.pushMethod,
    httpsTokenEnv: packageLevel.httpsTokenEnv ?? base.httpsTokenEnv,
    push: packageLevel.push,
    skipHooks: packageLevel.skipHooks ?? base.skipHooks
  };
}
var MAX_JSONC_LENGTH = 1e5;
function parseJsonc(content) {
  if (content.length > MAX_JSONC_LENGTH) {
    throw new Error(`JSONC content too long: ${content.length} characters (max ${MAX_JSONC_LENGTH})`);
  }
  try {
    return JSON.parse(content);
  } catch {
    const cleaned = content.replace(/\/\/[^\r\n]{0,10000}$/gm, "").replace(/\/\*[\s\S]{0,50000}?\*\//g, "").trim();
    return JSON.parse(cleaned);
  }
}
var GitConfigSchema = z.object({
  remote: z.string().default("origin"),
  branch: z.string().default("main"),
  pushMethod: z.enum(["auto", "ssh", "https"]).default("auto"),
  /**
   * Optional env var name containing a GitHub token for HTTPS pushes.
   * When set, publish steps can use this token without mutating git remotes.
   */
  httpsTokenEnv: z.string().optional(),
  push: z.boolean().optional(),
  skipHooks: z.boolean().optional()
});
var MonorepoConfigSchema = z.object({
  mode: z.enum(["root", "packages", "both"]).optional(),
  rootPath: z.string().optional(),
  packagesPath: z.string().optional(),
  mainPackage: z.string().optional()
});
var BranchPatternSchema = z.object({
  pattern: z.string(),
  releaseType: z.enum(["major", "minor", "patch", "prerelease"])
});
var VersionCargoConfigSchema = z.object({
  enabled: z.boolean().default(true),
  paths: z.array(z.string()).optional()
});
var VersionConfigSchema = z.object({
  tagTemplate: z.string().default("v{version}"),
  packageSpecificTags: z.boolean().default(false),
  preset: z.string().default("conventional"),
  sync: z.boolean().default(true),
  packages: z.array(z.string()).default([]),
  mainPackage: z.string().optional(),
  updateInternalDependencies: z.enum(["major", "minor", "patch", "no-internal-update"]).default("minor"),
  skip: z.array(z.string()).optional(),
  commitMessage: z.string().optional(),
  versionStrategy: z.enum(["branchPattern", "commitMessage"]).default("commitMessage"),
  branchPatterns: z.array(BranchPatternSchema).optional(),
  defaultReleaseType: z.enum(["major", "minor", "patch", "prerelease"]).optional(),
  mismatchStrategy: z.enum(["error", "warn", "ignore", "prefer-package", "prefer-git"]).default("warn"),
  versionPrefix: z.string().default(""),
  prereleaseIdentifier: z.string().optional(),
  strictReachable: z.boolean().default(false),
  cargo: VersionCargoConfigSchema.optional()
});
var NpmConfigSchema = z.object({
  enabled: z.boolean().default(true),
  auth: z.enum(["auto", "oidc", "token"]).default("auto"),
  provenance: z.boolean().default(true),
  access: z.enum(["public", "restricted"]).default("public"),
  registry: z.string().default("https://registry.npmjs.org"),
  copyFiles: z.array(z.string()).default(["LICENSE"]),
  tag: z.string().default("latest")
});
var CargoPublishConfigSchema = z.object({
  enabled: z.boolean().default(false),
  noVerify: z.boolean().default(false),
  publishOrder: z.array(z.string()).default([]),
  clean: z.boolean().default(false)
});
var PublishGitConfigSchema = z.object({
  push: z.boolean().default(true),
  pushMethod: z.enum(["auto", "ssh", "https"]).optional(),
  remote: z.string().optional(),
  branch: z.string().optional(),
  httpsTokenEnv: z.string().optional(),
  skipHooks: z.boolean().optional()
});
var GitHubReleaseConfigSchema = z.object({
  enabled: z.boolean().default(true),
  draft: z.boolean().default(true),
  perPackage: z.boolean().default(true),
  prerelease: z.union([z.literal("auto"), z.boolean()]).default("auto"),
  /**
   * Controls the source for the GitHub release body.
   * - 'auto': Use release notes if enabled, else changelog, else GitHub auto-generated.
   * - 'releaseNotes': Use LLM-generated release notes (requires notes.releaseNotes.enabled: true).
   * - 'changelog': Use formatted changelog entries.
   * - 'generated': Use GitHub's auto-generated notes.
   * - 'none': No body.
   */
  body: z.enum(["auto", "releaseNotes", "changelog", "generated", "none"]).default("auto"),
  /**
   * Template string for the GitHub release title when a package name is resolved.
   * Available variables: ${packageName} (original scoped name), ${version} (e.g. "v1.0.0").
   * Version-only tags (e.g. "v1.0.0") always use the tag as-is.
   */
  /* biome-ignore lint/suspicious/noTemplateCurlyInString: default template value */
  titleTemplate: z.string().default("${packageName}: ${version}")
});
var VerifyRegistryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxAttempts: z.number().int().positive().default(5),
  initialDelay: z.number().int().positive().default(15e3),
  backoffMultiplier: z.number().positive().default(2)
});
var VerifyConfigSchema = z.object({
  npm: VerifyRegistryConfigSchema.default({
    enabled: true,
    maxAttempts: 5,
    initialDelay: 15e3,
    backoffMultiplier: 2
  }),
  cargo: VerifyRegistryConfigSchema.default({
    enabled: true,
    maxAttempts: 10,
    initialDelay: 3e4,
    backoffMultiplier: 2
  })
});
var PublishConfigSchema = z.object({
  git: PublishGitConfigSchema.optional(),
  npm: NpmConfigSchema.default({
    enabled: true,
    auth: "auto",
    provenance: true,
    access: "public",
    registry: "https://registry.npmjs.org",
    copyFiles: ["LICENSE"],
    tag: "latest"
  }),
  cargo: CargoPublishConfigSchema.default({
    enabled: false,
    noVerify: false,
    publishOrder: [],
    clean: false
  }),
  githubRelease: GitHubReleaseConfigSchema.default({
    enabled: true,
    draft: true,
    perPackage: true,
    prerelease: "auto",
    body: "auto",
    /* biome-ignore lint/suspicious/noTemplateCurlyInString: default template value */
    titleTemplate: "${packageName}: ${version}"
  }),
  verify: VerifyConfigSchema.default({
    npm: {
      enabled: true,
      maxAttempts: 5,
      initialDelay: 15e3,
      backoffMultiplier: 2
    },
    cargo: {
      enabled: true,
      maxAttempts: 10,
      initialDelay: 3e4,
      backoffMultiplier: 2
    }
  })
});
var TemplateConfigSchema = z.object({
  path: z.string().optional(),
  engine: z.enum(["handlebars", "liquid", "ejs"]).optional()
});
var LocationModeSchema = z.enum(["root", "packages", "both"]);
var ChangelogConfigSchema = z.object({
  mode: LocationModeSchema.optional(),
  file: z.string().optional(),
  templates: TemplateConfigSchema.optional()
});
var LLMOptionsSchema = z.object({
  timeout: z.number().optional(),
  maxTokens: z.number().optional(),
  temperature: z.number().optional()
});
var LLMRetryConfigSchema = z.object({
  maxAttempts: z.number().int().positive().optional(),
  initialDelay: z.number().nonnegative().optional(),
  maxDelay: z.number().positive().optional(),
  backoffFactor: z.number().positive().optional()
});
var LLMTasksConfigSchema = z.object({
  summarize: z.boolean().optional(),
  enhance: z.boolean().optional(),
  categorize: z.boolean().optional(),
  releaseNotes: z.boolean().optional()
});
var LLMCategorySchema = z.object({
  name: z.string(),
  description: z.string(),
  scopes: z.array(z.string()).optional()
});
var ScopeRulesSchema = z.object({
  allowed: z.array(z.string()).optional(),
  caseSensitive: z.boolean().default(false),
  invalidScopeAction: z.enum(["remove", "keep", "fallback"]).default("remove"),
  fallbackScope: z.string().optional()
});
var ScopeConfigSchema = z.object({
  mode: z.enum(["restricted", "packages", "none", "unrestricted"]).default("unrestricted"),
  rules: ScopeRulesSchema.optional()
});
var LLMPromptOverridesSchema = z.object({
  enhance: z.string().optional(),
  categorize: z.string().optional(),
  enhanceAndCategorize: z.string().optional(),
  summarize: z.string().optional(),
  releaseNotes: z.string().optional()
});
var LLMPromptsConfigSchema = z.object({
  instructions: LLMPromptOverridesSchema.optional(),
  templates: LLMPromptOverridesSchema.optional()
});
var LLMConfigSchema = z.object({
  provider: z.string(),
  model: z.string(),
  baseURL: z.string().optional(),
  apiKey: z.string().optional(),
  options: LLMOptionsSchema.optional(),
  concurrency: z.number().int().positive().optional(),
  retry: LLMRetryConfigSchema.optional(),
  tasks: LLMTasksConfigSchema.optional(),
  categories: z.array(LLMCategorySchema).optional(),
  style: z.string().optional(),
  scopes: ScopeConfigSchema.optional(),
  prompts: LLMPromptsConfigSchema.optional()
});
var ReleaseNotesConfigSchema = z.object({
  mode: LocationModeSchema.optional(),
  file: z.string().optional(),
  templates: TemplateConfigSchema.optional(),
  llm: LLMConfigSchema.optional()
});
var NotesInputConfigSchema = z.object({
  source: z.string().optional(),
  file: z.string().optional()
});
var NotesConfigSchema = z.object({
  changelog: z.union([z.literal(false), ChangelogConfigSchema]).optional(),
  releaseNotes: z.union([z.literal(false), ReleaseNotesConfigSchema]).optional(),
  updateStrategy: z.enum(["prepend", "regenerate"]).optional()
});
var CILabelsConfigSchema = z.object({
  stable: z.string().default("release:stable"),
  prerelease: z.string().default("release:prerelease"),
  skip: z.string().default("release:skip"),
  major: z.string().default("release:major"),
  minor: z.string().default("release:minor"),
  patch: z.string().default("release:patch")
});
var CIConfigSchema = z.object({
  releaseStrategy: z.enum(["manual", "direct", "standing-pr", "scheduled"]).default("direct"),
  releaseTrigger: z.enum(["commit", "label"]).default("label"),
  prPreview: z.boolean().default(true),
  autoRelease: z.boolean().default(false),
  /**
   * Commit message prefixes that should not trigger a release.
   * Defaults to `['chore: release ']` to match the release commit template
   * (`chore: release ${packageName} v${version}`) and provide a
   * secondary loop-prevention guard alongside `[skip ci]`.
   */
  skipPatterns: z.array(z.string()).default(["chore: release "]),
  minChanges: z.number().int().positive().default(1),
  labels: CILabelsConfigSchema.default({
    stable: "release:stable",
    prerelease: "release:prerelease",
    skip: "release:skip",
    major: "release:major",
    minor: "release:minor",
    patch: "release:patch"
  })
});
var ReleaseCIConfigSchema = z.object({
  skipPatterns: z.array(z.string().min(1)).optional(),
  minChanges: z.number().int().positive().optional(),
  /** Set to `false` to disable GitHub release creation in CI. */
  githubRelease: z.literal(false).optional(),
  /** Set to `false` to disable changelog generation in CI. */
  notes: z.literal(false).optional()
});
var ReleaseConfigSchema = z.object({
  /**
   * Optional steps to enable. The version step always runs; only 'notes' and
   * 'publish' can be opted out. Omitting a step is equivalent to --skip-<step>.
   */
  steps: z.array(z.enum(["notes", "publish"])).min(1).optional(),
  ci: ReleaseCIConfigSchema.optional()
});
var ReleaseKitConfigSchema = z.object({
  git: GitConfigSchema.optional(),
  monorepo: MonorepoConfigSchema.optional(),
  version: VersionConfigSchema.optional(),
  publish: PublishConfigSchema.optional(),
  notes: NotesConfigSchema.optional(),
  ci: CIConfigSchema.optional(),
  release: ReleaseConfigSchema.optional()
});
var MAX_INPUT_LENGTH = 1e4;
function substituteVariables(value) {
  if (value.length > MAX_INPUT_LENGTH) {
    throw new Error(`Input too long: ${value.length} characters (max ${MAX_INPUT_LENGTH})`);
  }
  const envPattern = /\{env:([^}]{1,1000})\}/g;
  const filePattern = /\{file:([^}]{1,1000})\}/g;
  let result = value;
  result = result.replace(envPattern, (_, varName) => {
    return process.env[varName] ?? "";
  });
  result = result.replace(filePattern, (_, filePath) => {
    const expandedPath = filePath.startsWith("~") ? path22.join(os.homedir(), filePath.slice(1)) : filePath;
    try {
      return fs22.readFileSync(expandedPath, "utf-8").trim();
    } catch {
      return "";
    }
  });
  return result;
}
var SOLE_REFERENCE_PATTERN = /^\{(?:env|file):[^}]+\}$/;
function substituteInObject(obj) {
  if (typeof obj === "string") {
    const result = substituteVariables(obj);
    if (result === "" && SOLE_REFERENCE_PATTERN.test(obj)) {
      return void 0;
    }
    return result;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => substituteInObject(item));
  }
  if (obj && typeof obj === "object") {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteInObject(value);
    }
    return result;
  }
  return obj;
}
var AUTH_DIR = path22.join(os.homedir(), ".config", "releasekit");
var AUTH_FILE = path22.join(AUTH_DIR, "auth.json");
var CONFIG_FILE = "releasekit.config.json";
function loadConfigFile(configPath) {
  if (!fs3.existsSync(configPath)) {
    return {};
  }
  try {
    const content = fs3.readFileSync(configPath, "utf-8");
    const parsed = parseJsonc(content);
    const substituted = substituteInObject(parsed);
    return ReleaseKitConfigSchema.parse(substituted);
  } catch (error) {
    if (error instanceof z2.ZodError) {
      const issues = error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
      throw new ConfigError(`Config validation errors:
${issues}`);
    }
    if (error instanceof SyntaxError) {
      throw new ConfigError(`Invalid JSON in config file: ${error.message}`);
    }
    throw error;
  }
}
function loadConfig(options) {
  const cwd = options?.cwd ?? process.cwd();
  const configPath = options?.configPath ?? path3.join(cwd, CONFIG_FILE);
  return loadConfigFile(configPath);
}
function loadPublishConfig(options) {
  const config = loadConfig(options);
  if (!config.publish) return void 0;
  const mergedGit = mergeGitConfig(config.git, config.publish.git);
  return {
    ...config.publish,
    git: mergedGit ? {
      push: mergedGit.push ?? true,
      pushMethod: mergedGit.pushMethod,
      remote: mergedGit.remote,
      branch: mergedGit.branch,
      httpsTokenEnv: mergedGit.httpsTokenEnv,
      skipHooks: mergedGit.skipHooks
    } : void 0
  };
}
function getDefaultConfig() {
  return {
    npm: {
      enabled: true,
      auth: "auto",
      provenance: true,
      access: "public",
      registry: "https://registry.npmjs.org",
      copyFiles: ["LICENSE"],
      tag: "latest"
    },
    cargo: {
      enabled: false,
      noVerify: false,
      publishOrder: [],
      clean: false
    },
    git: {
      push: true,
      pushMethod: "auto",
      remote: "origin",
      branch: void 0,
      httpsTokenEnv: void 0,
      skipHooks: false
    },
    githubRelease: {
      enabled: true,
      draft: true,
      perPackage: true,
      prerelease: "auto",
      body: "auto",
      /* biome-ignore lint/suspicious/noTemplateCurlyInString: default template value */
      titleTemplate: "${packageName}: ${version}"
    },
    verify: {
      npm: {
        enabled: true,
        maxAttempts: 5,
        initialDelay: 15e3,
        backoffMultiplier: 2
      },
      cargo: {
        enabled: true,
        maxAttempts: 10,
        initialDelay: 3e4,
        backoffMultiplier: 2
      }
    }
  };
}
function toPublishConfig(config) {
  const defaults = getDefaultConfig();
  if (!config) return defaults;
  return {
    npm: {
      enabled: config.npm?.enabled ?? defaults.npm.enabled,
      auth: config.npm?.auth ?? defaults.npm.auth,
      provenance: config.npm?.provenance ?? defaults.npm.provenance,
      access: config.npm?.access ?? defaults.npm.access,
      registry: config.npm?.registry ?? defaults.npm.registry,
      copyFiles: config.npm?.copyFiles ?? defaults.npm.copyFiles,
      tag: config.npm?.tag ?? defaults.npm.tag
    },
    cargo: {
      enabled: config.cargo?.enabled ?? defaults.cargo.enabled,
      noVerify: config.cargo?.noVerify ?? defaults.cargo.noVerify,
      publishOrder: config.cargo?.publishOrder ?? defaults.cargo.publishOrder,
      clean: config.cargo?.clean ?? defaults.cargo.clean
    },
    git: config.git ? {
      push: config.git.push ?? defaults.git.push,
      pushMethod: config.git.pushMethod ?? defaults.git.pushMethod,
      remote: config.git.remote ?? defaults.git.remote,
      branch: config.git.branch ?? defaults.git.branch,
      httpsTokenEnv: config.git.httpsTokenEnv ?? defaults.git.httpsTokenEnv,
      skipHooks: config.git.skipHooks ?? defaults.git.skipHooks
    } : defaults.git,
    githubRelease: {
      enabled: config.githubRelease?.enabled ?? defaults.githubRelease.enabled,
      draft: config.githubRelease?.draft ?? defaults.githubRelease.draft,
      perPackage: config.githubRelease?.perPackage ?? defaults.githubRelease.perPackage,
      prerelease: config.githubRelease?.prerelease ?? defaults.githubRelease.prerelease,
      body: config.githubRelease?.body ?? defaults.githubRelease.body,
      titleTemplate: config.githubRelease?.titleTemplate ?? defaults.githubRelease.titleTemplate
    },
    verify: {
      npm: {
        enabled: config.verify?.npm?.enabled ?? defaults.verify.npm.enabled,
        maxAttempts: config.verify?.npm?.maxAttempts ?? defaults.verify.npm.maxAttempts,
        initialDelay: config.verify?.npm?.initialDelay ?? defaults.verify.npm.initialDelay,
        backoffMultiplier: config.verify?.npm?.backoffMultiplier ?? defaults.verify.npm.backoffMultiplier
      },
      cargo: {
        enabled: config.verify?.cargo?.enabled ?? defaults.verify.cargo.enabled,
        maxAttempts: config.verify?.cargo?.maxAttempts ?? defaults.verify.cargo.maxAttempts,
        initialDelay: config.verify?.cargo?.initialDelay ?? defaults.verify.cargo.initialDelay,
        backoffMultiplier: config.verify?.cargo?.backoffMultiplier ?? defaults.verify.cargo.backoffMultiplier
      }
    }
  };
}
function loadConfig2(options) {
  const baseConfig = loadPublishConfig(options);
  return toPublishConfig(baseConfig);
}
function getDefaultConfig2() {
  return toPublishConfig(void 0);
}
var BasePublishError = class _BasePublishError extends ReleaseKitError {
  code;
  suggestions;
  constructor(message, code, suggestions) {
    super(message);
    this.code = code;
    this.suggestions = suggestions ?? [];
  }
  static isPublishError(error) {
    return error instanceof _BasePublishError;
  }
};
var PublishError = class extends BasePublishError {
};
var PipelineError = class extends BasePublishError {
  partialOutput;
  failedStage;
  cause;
  constructor(message, failedStage, partialOutput, cause) {
    super(message, "PIPELINE_STAGE_ERROR", [
      "Check the partial output for results from stages that completed before the failure",
      "Use --json to get structured error output with partial results"
    ]);
    this.failedStage = failedStage;
    this.partialOutput = partialOutput;
    this.cause = cause;
  }
};
var PublishErrorCode = /* @__PURE__ */ ((PublishErrorCode2) => {
  PublishErrorCode2["INPUT_PARSE_ERROR"] = "INPUT_PARSE_ERROR";
  PublishErrorCode2["INPUT_VALIDATION_ERROR"] = "INPUT_VALIDATION_ERROR";
  PublishErrorCode2["CONFIG_ERROR"] = "CONFIG_ERROR";
  PublishErrorCode2["GIT_COMMIT_ERROR"] = "GIT_COMMIT_ERROR";
  PublishErrorCode2["GIT_TAG_ERROR"] = "GIT_TAG_ERROR";
  PublishErrorCode2["GIT_PUSH_ERROR"] = "GIT_PUSH_ERROR";
  PublishErrorCode2["NPM_PUBLISH_ERROR"] = "NPM_PUBLISH_ERROR";
  PublishErrorCode2["NPM_AUTH_ERROR"] = "NPM_AUTH_ERROR";
  PublishErrorCode2["CARGO_PUBLISH_ERROR"] = "CARGO_PUBLISH_ERROR";
  PublishErrorCode2["CARGO_AUTH_ERROR"] = "CARGO_AUTH_ERROR";
  PublishErrorCode2["VERIFICATION_FAILED"] = "VERIFICATION_FAILED";
  PublishErrorCode2["GITHUB_RELEASE_ERROR"] = "GITHUB_RELEASE_ERROR";
  PublishErrorCode2["FILE_COPY_ERROR"] = "FILE_COPY_ERROR";
  PublishErrorCode2["CARGO_TOML_ERROR"] = "CARGO_TOML_ERROR";
  PublishErrorCode2["PIPELINE_STAGE_ERROR"] = "PIPELINE_STAGE_ERROR";
  return PublishErrorCode2;
})(PublishErrorCode || {});
function createPublishError(code, details) {
  const messages = {
    [
      "INPUT_PARSE_ERROR"
      /* INPUT_PARSE_ERROR */
    ]: "Failed to parse version output",
    [
      "INPUT_VALIDATION_ERROR"
      /* INPUT_VALIDATION_ERROR */
    ]: "Version output validation failed",
    [
      "CONFIG_ERROR"
      /* CONFIG_ERROR */
    ]: "Invalid publish configuration",
    [
      "GIT_COMMIT_ERROR"
      /* GIT_COMMIT_ERROR */
    ]: "Failed to create git commit",
    [
      "GIT_TAG_ERROR"
      /* GIT_TAG_ERROR */
    ]: "Failed to create git tag",
    [
      "GIT_PUSH_ERROR"
      /* GIT_PUSH_ERROR */
    ]: "Failed to push to remote",
    [
      "NPM_PUBLISH_ERROR"
      /* NPM_PUBLISH_ERROR */
    ]: "Failed to publish to npm",
    [
      "NPM_AUTH_ERROR"
      /* NPM_AUTH_ERROR */
    ]: "NPM authentication failed",
    [
      "CARGO_PUBLISH_ERROR"
      /* CARGO_PUBLISH_ERROR */
    ]: "Failed to publish to crates.io",
    [
      "CARGO_AUTH_ERROR"
      /* CARGO_AUTH_ERROR */
    ]: "Cargo authentication failed",
    [
      "VERIFICATION_FAILED"
      /* VERIFICATION_FAILED */
    ]: "Package verification failed",
    [
      "GITHUB_RELEASE_ERROR"
      /* GITHUB_RELEASE_ERROR */
    ]: "Failed to create GitHub release",
    [
      "FILE_COPY_ERROR"
      /* FILE_COPY_ERROR */
    ]: "Failed to copy files",
    [
      "CARGO_TOML_ERROR"
      /* CARGO_TOML_ERROR */
    ]: "Failed to update Cargo.toml",
    [
      "PIPELINE_STAGE_ERROR"
      /* PIPELINE_STAGE_ERROR */
    ]: "Pipeline stage failed"
  };
  const suggestions = {
    [
      "INPUT_PARSE_ERROR"
      /* INPUT_PARSE_ERROR */
    ]: [
      "Ensure the input is valid JSON from @releasekit/version --json",
      "Check that stdin is piped correctly or --input path is valid"
    ],
    [
      "INPUT_VALIDATION_ERROR"
      /* INPUT_VALIDATION_ERROR */
    ]: [
      "Ensure the input matches the expected VersionOutput schema",
      "Run @releasekit/version with --json to generate valid output"
    ],
    [
      "CONFIG_ERROR"
      /* CONFIG_ERROR */
    ]: [
      "Validate publish.config.json syntax",
      "Check configuration against the schema",
      "Review documentation for valid configuration options"
    ],
    [
      "GIT_COMMIT_ERROR"
      /* GIT_COMMIT_ERROR */
    ]: [
      "Ensure there are staged changes to commit",
      "Check git user.name and user.email are configured",
      "Verify you have write access to the repository"
    ],
    [
      "GIT_TAG_ERROR"
      /* GIT_TAG_ERROR */
    ]: [
      "Check if the tag already exists: git tag -l <tag>",
      "Delete existing tag if needed: git tag -d <tag>"
    ],
    [
      "GIT_PUSH_ERROR"
      /* GIT_PUSH_ERROR */
    ]: [
      "Verify remote repository access",
      "Check SSH key or deploy key configuration",
      "Ensure the branch is not protected or you have push access"
    ],
    [
      "NPM_PUBLISH_ERROR"
      /* NPM_PUBLISH_ERROR */
    ]: [
      "Check npm registry availability",
      "Verify package name is not already taken by another owner",
      "Ensure package version has not already been published"
    ],
    [
      "NPM_AUTH_ERROR"
      /* NPM_AUTH_ERROR */
    ]: [
      "Set NPM_TOKEN environment variable for token-based auth",
      "Enable OIDC trusted publishing in GitHub Actions for provenance",
      "Run npm login for local publishing"
    ],
    [
      "CARGO_PUBLISH_ERROR"
      /* CARGO_PUBLISH_ERROR */
    ]: [
      "Check crates.io registry availability",
      "Verify crate name ownership on crates.io",
      "Ensure Cargo.toml metadata is complete (description, license, etc.)"
    ],
    [
      "CARGO_AUTH_ERROR"
      /* CARGO_AUTH_ERROR */
    ]: [
      "Set CARGO_REGISTRY_TOKEN environment variable",
      "Generate a token at https://crates.io/settings/tokens"
    ],
    [
      "VERIFICATION_FAILED"
      /* VERIFICATION_FAILED */
    ]: [
      "Registry propagation may take longer than expected",
      "Try increasing verify.maxAttempts or verify.initialDelay in config",
      "Check registry status pages for outages"
    ],
    [
      "GITHUB_RELEASE_ERROR"
      /* GITHUB_RELEASE_ERROR */
    ]: [
      "Ensure gh CLI is installed and authenticated",
      "Verify GITHUB_TOKEN has contents:write permission",
      "Check that the tag exists in the remote repository"
    ],
    [
      "FILE_COPY_ERROR"
      /* FILE_COPY_ERROR */
    ]: ["Verify the source file exists in the project root", "Check file permissions"],
    [
      "CARGO_TOML_ERROR"
      /* CARGO_TOML_ERROR */
    ]: [
      "Ensure Cargo.toml exists and is valid TOML",
      "Check that the [package] section has a version field"
    ],
    [
      "PIPELINE_STAGE_ERROR"
      /* PIPELINE_STAGE_ERROR */
    ]: [
      "Check the partial output for results from stages that completed before the failure",
      "Use --json to get structured error output with partial results"
    ]
  };
  const baseMessage = messages[code];
  const fullMessage = details ? `${baseMessage}: ${details}` : baseMessage;
  return new PublishError(fullMessage, code, suggestions[code]);
}
function redactArg(arg) {
  try {
    const url = new URL(arg);
    if (url.username || url.password) {
      url.username = url.username ? "***" : "";
      url.password = url.password ? "***" : "";
      return url.toString();
    }
  } catch {
  }
  return arg;
}
async function execCommand(file, args, options = {}) {
  const displayCommand = options.label ?? [file, ...args.map(redactArg)].join(" ");
  if (options.dryRun) {
    info(`[DRY RUN] Would execute: ${displayCommand}`);
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  debug(`Executing: ${displayCommand}`);
  return new Promise((resolve6, reject) => {
    execFile(
      file,
      args,
      {
        maxBuffer: 1024 * 1024 * 10,
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : void 0
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            Object.assign(new Error(error.message), {
              stdout: stdout.toString(),
              stderr: stderr.toString(),
              exitCode: error.code ?? 1
            })
          );
        } else {
          resolve6({
            stdout: stdout.toString(),
            stderr: stderr.toString(),
            exitCode: 0
          });
        }
      }
    );
  });
}
async function execCommandSafe(file, args, options = {}) {
  try {
    return await execCommand(file, args, options);
  } catch (error) {
    if (error && typeof error === "object" && "stdout" in error) {
      const execError = error;
      return {
        stdout: execError.stdout ?? "",
        stderr: execError.stderr ?? "",
        exitCode: execError.exitCode ?? 1
      };
    }
    return { stdout: "", stderr: error instanceof Error ? error.message : String(error), exitCode: 1 };
  }
}
function detectNpmAuth() {
  if (process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    return "oidc";
  }
  if (process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN) {
    return "token";
  }
  return null;
}
function hasCargoAuth() {
  return !!process.env.CARGO_REGISTRY_TOKEN;
}
async function detectGitPushMethod(remote, cwd) {
  const result = await execCommand("git", ["remote", "get-url", remote], { cwd });
  const url = result.stdout.trim();
  if (url.startsWith("git@") || url.startsWith("ssh://")) {
    return "ssh";
  }
  return "https";
}
function updateCargoVersion(cargoPath, newVersion) {
  try {
    const cargo = parseCargoToml(cargoPath);
    if (cargo.package) {
      cargo.package.version = newVersion;
      fs4.writeFileSync(cargoPath, TOML2.stringify(cargo));
    }
  } catch (error) {
    throw createPublishError(
      "CARGO_TOML_ERROR",
      `${cargoPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
function extractPathDeps(manifest) {
  const pathDeps = [];
  const deps = manifest.dependencies;
  if (deps) {
    for (const dep of Object.values(deps)) {
      if (dep && typeof dep === "object" && "path" in dep) {
        pathDeps.push(dep.path);
      }
    }
  }
  return pathDeps;
}
function isPrerelease(version) {
  return import_semver.default.prerelease(version) !== null;
}
function getDistTag(version, defaultTag = "latest") {
  const pre = import_semver.default.prerelease(version);
  if (pre && pre.length > 0) {
    const identifier = pre[0];
    return typeof identifier === "string" ? identifier : "next";
  }
  return defaultTag;
}
function detectPackageManager(cwd) {
  if (fs5.existsSync(path4.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (fs5.existsSync(path4.join(cwd, "yarn.lock"))) return "yarn";
  return "npm";
}
function buildPublishCommand(pm, packageName, _packageDir, options) {
  const args = ["publish"];
  let file;
  if (pm === "pnpm") {
    file = "pnpm";
    args.push("--filter", packageName, "--access", options.access, "--tag", options.tag);
    if (options.noGitChecks) args.push("--no-git-checks");
  } else {
    file = "npm";
    args.push("--access", options.access, "--tag", options.tag);
  }
  if (options.provenance) {
    args.push("--provenance");
  }
  return { file, args };
}
function buildViewCommand(pm, packageName, version) {
  const file = pm === "pnpm" ? "pnpm" : "npm";
  return { file, args: ["view", `${packageName}@${version}`, "version", "--json"] };
}
async function runCargoPublishStage(ctx) {
  const { input, config, cliOptions, cwd } = ctx;
  const dryRun = cliOptions.dryRun;
  if (!config.cargo.enabled) {
    debug("Cargo publishing disabled in config");
    return;
  }
  if (!hasCargoAuth() && !dryRun) {
    throw createPublishError("CARGO_AUTH_ERROR", "CARGO_REGISTRY_TOKEN not set");
  }
  const crates = findCrates(
    input.updates.map((u) => ({ dir: path5.dirname(path5.resolve(cwd, u.filePath)), ...u })),
    cwd
  );
  if (crates.length === 0) {
    debug("No Cargo crates found to publish");
    return;
  }
  const ordered = orderCrates(crates, config.cargo.publishOrder);
  for (const crate of ordered) {
    const result = {
      packageName: crate.name,
      version: crate.version,
      registry: "cargo",
      success: false,
      skipped: false
    };
    const searchResult = await execCommandSafe("cargo", ["search", crate.name, "--limit", "1"], { cwd, dryRun: false });
    if (searchResult.exitCode === 0 && searchResult.stdout.includes(`"${crate.version}"`)) {
      result.alreadyPublished = true;
      result.skipped = true;
      result.success = true;
      result.reason = "Already published on crates.io";
      ctx.output.cargo.push(result);
      warn(`${crate.name}@${crate.version} is already published on crates.io, skipping`);
      continue;
    }
    if (config.cargo.clean) {
      await execCommand("cargo", ["clean"], { cwd: crate.dir, dryRun, label: `cargo clean (${crate.name})` });
    }
    const publishArgs = ["publish", "--manifest-path", crate.manifestPath];
    if (config.cargo.noVerify) {
      publishArgs.push("--no-verify");
    }
    try {
      await execCommand("cargo", publishArgs, {
        cwd,
        dryRun,
        label: `cargo publish ${crate.name}@${crate.version}`
      });
      result.success = true;
      if (!dryRun) {
        success(`Published ${crate.name}@${crate.version} to crates.io`);
      }
      ctx.output.cargo.push(result);
    } catch (error) {
      result.reason = error instanceof Error ? error.message : String(error);
      ctx.output.cargo.push(result);
      throw createPublishError(
        "CARGO_PUBLISH_ERROR",
        `${crate.name}@${crate.version}: ${result.reason}`
      );
    }
  }
}
function findCrates(updates, _cwd) {
  const crates = [];
  for (const update of updates) {
    const cargoPath = path5.join(update.dir, "Cargo.toml");
    if (!fs6.existsSync(cargoPath)) {
      continue;
    }
    try {
      const cargo = parseCargoToml(cargoPath);
      if (!cargo.package?.name) {
        continue;
      }
      const pathDeps = extractPathDeps(cargo);
      crates.push({
        name: cargo.package.name,
        version: update.newVersion,
        dir: update.dir,
        manifestPath: cargoPath,
        pathDeps
      });
    } catch {
    }
  }
  return crates;
}
function orderCrates(crates, explicitOrder) {
  if (explicitOrder.length > 0) {
    const ordered = [];
    const byName = new Map(crates.map((c) => [c.name, c]));
    for (const name of explicitOrder) {
      const crate = byName.get(name);
      if (crate) {
        ordered.push(crate);
        byName.delete(name);
      }
    }
    for (const crate of byName.values()) {
      ordered.push(crate);
    }
    return ordered;
  }
  return topologicalSort(crates);
}
function topologicalSort(crates) {
  const nameSet = new Set(crates.map((c) => c.name));
  const graph = /* @__PURE__ */ new Map();
  const crateMap = new Map(crates.map((c) => [c.name, c]));
  for (const crate of crates) {
    graph.set(crate.name, []);
  }
  for (const crate of crates) {
    for (const depPath of crate.pathDeps) {
      const resolvedDir = path5.resolve(crate.dir, depPath);
      for (const other of crates) {
        if (path5.resolve(other.dir) === resolvedDir && nameSet.has(other.name)) {
          graph.get(crate.name)?.push(other.name);
        }
      }
    }
  }
  const inDegree = /* @__PURE__ */ new Map();
  for (const name of nameSet) {
    inDegree.set(name, 0);
  }
  for (const deps of graph.values()) {
    for (const dep of deps) {
      inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
    }
  }
  const queue = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) {
      queue.push(name);
    }
  }
  const result = [];
  while (queue.length > 0) {
    const name = queue.shift();
    if (!name) break;
    const crate = crateMap.get(name);
    if (crate) {
      result.push(crate);
    }
    for (const dep of graph.get(name) ?? []) {
      const newDegree = (inDegree.get(dep) ?? 1) - 1;
      inDegree.set(dep, newDegree);
      if (newDegree === 0) {
        queue.push(dep);
      }
    }
  }
  result.reverse();
  return result;
}
async function runGitCommitStage(ctx) {
  const { input, config, cliOptions, cwd } = ctx;
  const dryRun = cliOptions.dryRun;
  const skipHooks = config.git.skipHooks ?? false;
  if (!input.commitMessage) {
    info("No commit message provided, skipping git commit");
    return;
  }
  const filePaths = input.updates.map((u) => path6.resolve(cwd, u.filePath));
  if (ctx.additionalFiles) {
    filePaths.push(...ctx.additionalFiles.map((f) => path6.resolve(cwd, f)));
  }
  if (filePaths.length === 0) {
    info("No files to commit");
    return;
  }
  try {
    await execCommand("git", ["add", ...filePaths], {
      cwd,
      dryRun,
      label: `git add ${filePaths.length} file(s)`
    });
  } catch (error) {
    throw createPublishError(
      "GIT_COMMIT_ERROR",
      `git add failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const commitArgs = ["commit"];
  if (skipHooks) {
    commitArgs.push("--no-verify");
  }
  commitArgs.push("-m", input.commitMessage);
  try {
    await execCommand("git", commitArgs, {
      cwd,
      dryRun,
      label: `git commit -m "${input.commitMessage}"`
    });
    ctx.output.git.committed = true;
    if (!dryRun) {
      success("Created git commit");
    }
  } catch (error) {
    throw createPublishError(
      "GIT_COMMIT_ERROR",
      `git commit failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  for (const tag of input.tags) {
    try {
      const tagMessage = `Release ${tag}`;
      await execCommand("git", ["tag", "-a", tag, "-m", tagMessage], {
        cwd,
        dryRun,
        label: `git tag ${tag}`
      });
      ctx.output.git.tags.push(tag);
      if (!dryRun) {
        success(`Created tag: ${tag}`);
      }
    } catch (error) {
      throw createPublishError(
        "GIT_TAG_ERROR",
        `Failed to create tag ${tag}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
function toGithubAuthedUrl(remoteUrl, token) {
  try {
    const url = new URL(remoteUrl);
    if (url.protocol !== "https:") return void 0;
    if (url.host !== "github.com") return void 0;
    url.username = "x-access-token";
    url.password = token;
    return url.toString();
  } catch {
    return void 0;
  }
}
async function runGitPushStage(ctx) {
  const { config, cliOptions, cwd, output } = ctx;
  const dryRun = cliOptions.dryRun;
  if (!config.git.push) {
    info("Git push disabled in config, skipping");
    return;
  }
  if (!output.git.committed && output.git.tags.length === 0) {
    info("Nothing to push (no commits or tags created)");
    return;
  }
  const { remote } = config.git;
  let pushMethod = config.git.pushMethod;
  if (pushMethod === "auto") {
    try {
      pushMethod = await detectGitPushMethod(remote, cwd);
    } catch {
      pushMethod = "https";
    }
  }
  const httpsTokenEnv = config.git.httpsTokenEnv;
  const httpsToken = httpsTokenEnv ? process.env[httpsTokenEnv] : void 0;
  try {
    let pushRemote = remote;
    if (pushMethod === "https" && httpsToken) {
      const remoteUrlResult = await execCommand("git", ["remote", "get-url", remote], { cwd, dryRun: false });
      const authed = toGithubAuthedUrl(remoteUrlResult.stdout.trim(), httpsToken);
      if (authed) {
        pushRemote = authed;
      }
    }
    let branch;
    if (output.git.committed) {
      branch = config.git.branch;
      if (!branch) {
        const revResult = await execCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, dryRun: false });
        branch = revResult.stdout.trim();
        if (branch === "HEAD") {
          throw createPublishError(
            "GIT_PUSH_ERROR",
            "Cannot push: repository is in a detached HEAD state. Set git.branch in your config or pass --branch <name>."
          );
        }
      }
      await execCommand("git", ["push", pushRemote, branch], {
        cwd,
        dryRun,
        label: `git push ${remote} ${branch}`
      });
    }
    if (output.git.tags.length > 0) {
      await execCommand("git", ["push", pushRemote, "--tags"], {
        cwd,
        dryRun,
        label: `git push ${remote} --tags`
      });
    }
    ctx.output.git.pushed = true;
    if (!dryRun) {
      success(`Pushed to ${remote}${branch ? `/${branch}` : ""}`);
    }
  } catch (error) {
    if (error instanceof PublishError) {
      throw error;
    }
    throw createPublishError(
      "GIT_PUSH_ERROR",
      `${error instanceof Error ? error.message : String(error)}`
    );
  }
}
function resolveNotes(bodySource, tag, changelogs, releaseNotesEnabled, pipelineNotes) {
  if (bodySource === "none") {
    return { useGithubNotes: false };
  }
  if (bodySource === "generated") {
    return { useGithubNotes: true };
  }
  if (bodySource === "releaseNotes") {
    if (!releaseNotesEnabled) {
      warn("releaseNotes is not enabled in notes config but body is set to releaseNotes");
      return { useGithubNotes: true };
    }
    if (pipelineNotes) {
      const body = findNotesForTag(tag, pipelineNotes);
      if (body) return { body, useGithubNotes: false };
    }
    warn("No release notes found in pipeline output, falling back to GitHub auto-notes");
    return { useGithubNotes: true };
  }
  if (bodySource === "changelog") {
    const packageBody = formatChangelogForTag(tag, changelogs);
    if (packageBody) {
      return { body: packageBody, useGithubNotes: false };
    }
    warn("No changelog found for tag, falling back to GitHub auto-notes");
    return { useGithubNotes: true };
  }
  if (releaseNotesEnabled && pipelineNotes) {
    const body = findNotesForTag(tag, pipelineNotes);
    if (body) return { body, useGithubNotes: false };
    warn(`Release notes configured but no content found for tag ${tag}, falling back to GitHub auto-generated notes`);
  }
  return { useGithubNotes: true };
}
function isVersionOnlyTag(tag) {
  return /^v?\d+\.\d+\.\d+/.test(tag);
}
function resolveTagPackage(tag, packageNames) {
  const sorted = [...packageNames].sort((a, b) => sanitizePackageName(b).length - sanitizePackageName(a).length);
  for (const packageName of sorted) {
    const atPrefix = `${packageName}@`;
    if (tag.startsWith(atPrefix)) {
      return { packageName, version: tag.slice(atPrefix.length) };
    }
    const dashPrefix = `${sanitizePackageName(packageName)}-`;
    if (tag.startsWith(dashPrefix)) {
      const versionPart = tag.slice(dashPrefix.length);
      if (/^v?\d/.test(versionPart)) {
        return { packageName, version: versionPart };
      }
    }
  }
  return null;
}
function getTitleFromTag(tag, packageNames, titleTemplate) {
  const applyTemplate = (packageName, version) => titleTemplate.replace(/\$\{packageName\}/g, packageName).replace(/\$\{version\}/g, version);
  if (packageNames.length > 0) {
    const resolved = resolveTagPackage(tag, packageNames);
    if (resolved) return applyTemplate(resolved.packageName, resolved.version);
  }
  const atIndex = tag.lastIndexOf("@");
  if (atIndex === -1) return tag;
  return applyTemplate(tag.slice(0, atIndex), tag.slice(atIndex + 1));
}
function findNotesForTag(tag, notes) {
  const resolved = resolveTagPackage(tag, Object.keys(notes));
  if (resolved) {
    const body = notes[resolved.packageName];
    if (body?.trim()) return body;
  }
  const entries = Object.values(notes).filter((b) => b.trim());
  if (entries.length === 1 && isVersionOnlyTag(tag)) return entries[0];
  return void 0;
}
function formatChangelogForTag(tag, changelogs) {
  if (changelogs.length === 0) return void 0;
  const resolved = resolveTagPackage(
    tag,
    changelogs.map((c) => c.packageName)
  );
  let target;
  if (resolved) {
    target = changelogs.find((c) => c.packageName === resolved.packageName);
  } else if (changelogs.length === 1 && isVersionOnlyTag(tag)) {
    target = changelogs[0];
  }
  if (!target || target.entries.length === 0) return void 0;
  const lines = [];
  for (const entry of target.entries) {
    const scope = entry.scope ? `**${entry.scope}:** ` : "";
    lines.push(`- ${scope}${entry.description}`);
  }
  return lines.join("\n");
}
async function runGithubReleaseStage(ctx) {
  const { config, cliOptions, output } = ctx;
  const dryRun = cliOptions.dryRun;
  if (!config.githubRelease.enabled) {
    debug("GitHub releases disabled in config");
    return;
  }
  const tags = output.git.tags.length > 0 ? output.git.tags : ctx.input.tags;
  if (tags.length === 0) {
    info("No tags available for GitHub release");
    return;
  }
  const firstTag = tags[0];
  if (!firstTag) return;
  const tagsToRelease = config.githubRelease.perPackage ? tags : [firstTag];
  for (const tag of tagsToRelease) {
    const MAX_TAG_LENGTH = 1e3;
    const truncatedTag = tag.length > MAX_TAG_LENGTH ? tag.slice(0, MAX_TAG_LENGTH) : tag;
    const versionMatch = truncatedTag.match(/(\d{1,20}\.\d{1,20}\.\d{1,20}(?:[-+.]?[a-zA-Z0-9.-]{0,100})?)$/);
    const version = versionMatch?.[1] ?? "";
    const isPreRel = config.githubRelease.prerelease === "auto" ? version ? isPrerelease(version) : false : config.githubRelease.prerelease;
    const result = {
      tag,
      draft: config.githubRelease.draft,
      prerelease: isPreRel,
      success: false
    };
    const ghArgs = ["release", "create", tag];
    const titlePackageNames = [
      ...ctx.input.changelogs.map((c) => c.packageName),
      ...ctx.releaseNotes ? Object.keys(ctx.releaseNotes) : []
    ];
    ghArgs.push("--title", getTitleFromTag(tag, [...new Set(titlePackageNames)], config.githubRelease.titleTemplate));
    if (config.githubRelease.draft) {
      ghArgs.push("--draft");
    }
    if (isPreRel) {
      ghArgs.push("--prerelease");
    }
    const releaseNotesEnabled = !!(ctx.releaseNotes && Object.keys(ctx.releaseNotes).length > 0);
    const { body, useGithubNotes } = resolveNotes(
      config.githubRelease.body,
      tag,
      ctx.input.changelogs,
      releaseNotesEnabled,
      ctx.releaseNotes
    );
    if (body) {
      ghArgs.push("--notes", body);
    } else if (useGithubNotes) {
      ghArgs.push("--generate-notes");
    }
    try {
      const execResult = await execCommand("gh", ghArgs, {
        dryRun,
        label: `gh release create ${tag}`
      });
      result.success = true;
      if (!dryRun && execResult.stdout.trim()) {
        result.url = execResult.stdout.trim();
      }
      if (!dryRun) {
        success(`Created GitHub release for ${tag}`);
      }
    } catch (error) {
      result.reason = error instanceof Error ? error.message : String(error);
      warn(`Failed to create GitHub release for ${tag}: ${result.reason}`);
    }
    ctx.output.githubReleases.push(result);
  }
}
function writeTempNpmrc(contents) {
  const dir = fs7.mkdtempSync(path7.join(os2.tmpdir(), "releasekit-npmrc-"));
  const npmrcPath = path7.join(dir, ".npmrc");
  fs7.writeFileSync(npmrcPath, contents, "utf-8");
  return {
    npmrcPath,
    cleanup: () => {
      try {
        fs7.rmSync(dir, { recursive: true, force: true });
      } catch {
      }
    }
  };
}
function createNpmSubprocessIsolation(options) {
  const { authMethod, registryUrl } = options;
  const baseEnv = {};
  if (!authMethod) return { env: baseEnv, cleanup: () => {
  } };
  const token = process.env.NPM_TOKEN ?? process.env.NODE_AUTH_TOKEN;
  const registryHost = (() => {
    try {
      return new URL(registryUrl).host;
    } catch {
      return "registry.npmjs.org";
    }
  })();
  const lines = [`registry=${registryUrl}`];
  if (authMethod === "token" && token) {
    lines.push(`//${registryHost}/:_authToken=${token}`);
  }
  lines.push("");
  const { npmrcPath, cleanup } = writeTempNpmrc(lines.join("\n"));
  debug(`Using isolated npm userconfig: ${npmrcPath}`);
  const isOidc = authMethod === "oidc";
  return {
    env: {
      ...baseEnv,
      // Ensure npm and tools that read npm_config_* pick up our temp file
      NPM_CONFIG_USERCONFIG: npmrcPath,
      npm_config_userconfig: npmrcPath,
      // Auth-specific hardening
      ...isOidc ? {
        // Prevent any ambient token from overriding OIDC trusted publishing
        NODE_AUTH_TOKEN: void 0,
        NPM_TOKEN: void 0
      } : {
        // Ensure CLIs that expect NODE_AUTH_TOKEN can still work
        NODE_AUTH_TOKEN: token
      }
    },
    cleanup
  };
}
async function runNpmPublishStage(ctx) {
  const { input, config, cliOptions, cwd } = ctx;
  const dryRun = cliOptions.dryRun;
  if (!config.npm.enabled) {
    info("NPM publishing disabled in config");
    return;
  }
  const authMethod = config.npm.auth === "auto" ? detectNpmAuth() : config.npm.auth;
  if (!authMethod && !dryRun) {
    throw createPublishError("NPM_AUTH_ERROR", "No NPM authentication method detected");
  }
  const useProvenance = config.npm.provenance && authMethod === "oidc";
  const npmIsolation = createNpmSubprocessIsolation({
    authMethod,
    registryUrl: config.npm.registry
  });
  try {
    for (const update of input.updates) {
      const result = {
        packageName: update.packageName,
        version: update.newVersion,
        registry: "npm",
        success: false,
        skipped: false
      };
      const pkgJsonPath = path8.resolve(cwd, update.filePath);
      try {
        const pkgContent = fs8.readFileSync(pkgJsonPath, "utf-8");
        const pkgJson = JSON.parse(pkgContent);
        if (pkgJson.private) {
          result.skipped = true;
          result.success = true;
          result.reason = "Package is private";
          ctx.output.npm.push(result);
          debug(`Skipping private package: ${update.packageName}`);
          continue;
        }
      } catch {
        if (update.filePath.endsWith("Cargo.toml")) {
          result.skipped = true;
          result.success = true;
          result.reason = "Not an npm package";
          ctx.output.npm.push(result);
          continue;
        }
      }
      const { file: viewFile, args: viewArgs } = buildViewCommand(
        ctx.packageManager,
        update.packageName,
        update.newVersion
      );
      const viewResult = await execCommandSafe(viewFile, viewArgs, {
        cwd,
        dryRun: false,
        // Always check, even in dry-run
        env: npmIsolation.env
      });
      if (viewResult.exitCode === 0 && viewResult.stdout.trim()) {
        result.alreadyPublished = true;
        result.skipped = true;
        result.success = true;
        result.reason = "Already published";
        ctx.output.npm.push(result);
        warn(`${update.packageName}@${update.newVersion} is already published, skipping`);
        continue;
      }
      const distTag = getDistTag(update.newVersion, config.npm.tag);
      const pkgDir = path8.dirname(path8.resolve(cwd, update.filePath));
      const { file: pubFile, args: pubArgs } = buildPublishCommand(ctx.packageManager, update.packageName, pkgDir, {
        access: config.npm.access,
        tag: distTag,
        provenance: useProvenance,
        noGitChecks: true
      });
      try {
        await execCommand(pubFile, pubArgs, {
          cwd,
          dryRun,
          label: `npm publish ${update.packageName}@${update.newVersion}`,
          env: npmIsolation.env
        });
        result.success = true;
        if (!dryRun) {
          success(`Published ${update.packageName}@${update.newVersion} to npm`);
        }
        ctx.output.npm.push(result);
      } catch (error) {
        result.reason = error instanceof Error ? error.message : String(error);
        ctx.output.npm.push(result);
        throw createPublishError(
          "NPM_PUBLISH_ERROR",
          `${update.packageName}@${update.newVersion}: ${result.reason}`
        );
      }
    }
  } finally {
    npmIsolation.cleanup();
  }
}
async function runPrepareStage(ctx) {
  const { input, config, cliOptions, cwd } = ctx;
  if (config.npm.enabled && config.npm.copyFiles.length > 0) {
    for (const update of input.updates) {
      const pkgDir = path9.dirname(path9.resolve(cwd, update.filePath));
      for (const file of config.npm.copyFiles) {
        const src = path9.resolve(cwd, file);
        const dest = path9.join(pkgDir, file);
        if (!fs9.existsSync(src)) {
          debug(`Source file not found, skipping copy: ${src}`);
          continue;
        }
        if (path9.resolve(path9.dirname(src)) === path9.resolve(pkgDir)) {
          debug(`Skipping copy of ${file} - same directory as source`);
          continue;
        }
        if (cliOptions.dryRun) {
          info(`[DRY RUN] Would copy ${src} \u2192 ${dest}`);
          continue;
        }
        try {
          fs9.copyFileSync(src, dest);
          debug(`Copied ${file} \u2192 ${pkgDir}`);
        } catch (error) {
          throw createPublishError(
            "FILE_COPY_ERROR",
            `Failed to copy ${src} to ${dest}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }
  }
  if (config.cargo.enabled) {
    for (const update of input.updates) {
      const pkgDir = path9.dirname(path9.resolve(cwd, update.filePath));
      const cargoPath = path9.join(pkgDir, "Cargo.toml");
      if (!fs9.existsSync(cargoPath)) {
        continue;
      }
      if (cliOptions.dryRun) {
        info(`[DRY RUN] Would update ${cargoPath} to version ${update.newVersion}`);
        continue;
      }
      updateCargoVersion(cargoPath, update.newVersion);
      debug(`Updated ${cargoPath} to version ${update.newVersion}`);
    }
  }
}
async function withRetry(fn, options, shouldRetry) {
  let lastError;
  let delay = options.initialDelay;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (shouldRetry && !shouldRetry(error)) {
        throw error;
      }
      if (attempt < options.maxAttempts) {
        debug(`Attempt ${attempt}/${options.maxAttempts} failed, retrying in ${delay}ms...`);
        await sleep(delay);
        delay = Math.floor(delay * options.backoffMultiplier);
      }
    }
  }
  throw lastError;
}
function sleep(ms) {
  return new Promise((resolve6) => setTimeout(resolve6, ms));
}
async function runVerifyStage(ctx) {
  const { config, cliOptions, output, cwd } = ctx;
  if (config.verify.npm.enabled) {
    const published = output.npm.filter((r) => r.success && !r.skipped && !r.alreadyPublished);
    for (const pkg of published) {
      const result = {
        packageName: pkg.packageName,
        version: pkg.version,
        registry: "npm",
        verified: false,
        attempts: 0
      };
      if (cliOptions.dryRun) {
        info(`[DRY RUN] Would verify ${pkg.packageName}@${pkg.version} on npm`);
        result.verified = true;
        ctx.output.verification.push(result);
        continue;
      }
      try {
        await withRetry(async () => {
          result.attempts++;
          const { file: viewFile, args: viewArgs } = buildViewCommand(ctx.packageManager, pkg.packageName, pkg.version);
          const viewResult = await execCommandSafe(viewFile, viewArgs, {
            cwd,
            dryRun: false
          });
          if (viewResult.exitCode !== 0 || !viewResult.stdout.trim()) {
            throw new Error(`${pkg.packageName}@${pkg.version} not yet available on npm`);
          }
          debug(`Verified ${pkg.packageName}@${pkg.version} on npm`);
        }, config.verify.npm);
        result.verified = true;
        success(`Verified ${pkg.packageName}@${pkg.version} on npm`);
      } catch {
        warn(`Failed to verify ${pkg.packageName}@${pkg.version} on npm after ${result.attempts} attempts`);
      }
      ctx.output.verification.push(result);
    }
  }
  if (config.verify.cargo.enabled) {
    const published = output.cargo.filter((r) => r.success && !r.skipped && !r.alreadyPublished);
    for (const crate of published) {
      const result = {
        packageName: crate.packageName,
        version: crate.version,
        registry: "cargo",
        verified: false,
        attempts: 0
      };
      if (cliOptions.dryRun) {
        info(`[DRY RUN] Would verify ${crate.packageName}@${crate.version} on crates.io`);
        result.verified = true;
        ctx.output.verification.push(result);
        continue;
      }
      try {
        await withRetry(async () => {
          result.attempts++;
          const response = await fetch(`https://crates.io/api/v1/crates/${crate.packageName}/${crate.version}`);
          if (!response.ok) {
            throw new Error(`${crate.packageName}@${crate.version} not yet available on crates.io`);
          }
          debug(`Verified ${crate.packageName}@${crate.version} on crates.io`);
        }, config.verify.cargo);
        result.verified = true;
        success(`Verified ${crate.packageName}@${crate.version} on crates.io`);
      } catch {
        warn(`Failed to verify ${crate.packageName}@${crate.version} on crates.io after ${result.attempts} attempts`);
      }
      ctx.output.verification.push(result);
    }
  }
}
function inferStageName(error) {
  if (error instanceof BasePublishError) {
    const codeToStage = {
      FILE_COPY_ERROR: "prepare",
      CARGO_TOML_ERROR: "prepare",
      GIT_COMMIT_ERROR: "git-commit",
      GIT_TAG_ERROR: "git-commit",
      NPM_PUBLISH_ERROR: "npm-publish",
      NPM_AUTH_ERROR: "npm-publish",
      CARGO_PUBLISH_ERROR: "cargo-publish",
      CARGO_AUTH_ERROR: "cargo-publish",
      VERIFICATION_FAILED: "verify",
      GIT_PUSH_ERROR: "git-push",
      GITHUB_RELEASE_ERROR: "github-release"
    };
    return codeToStage[error.code] ?? "unknown";
  }
  return "unknown";
}
async function runPipeline(input, config, options) {
  const cwd = process.cwd();
  const ctx = {
    input,
    config,
    cliOptions: options,
    packageManager: detectPackageManager(cwd),
    cwd,
    releaseNotes: options.releaseNotes,
    additionalFiles: options.additionalFiles,
    output: {
      dryRun: options.dryRun,
      git: { committed: false, tags: [], pushed: false },
      npm: [],
      cargo: [],
      verification: [],
      githubReleases: [],
      publishSucceeded: false
    }
  };
  try {
    await runPrepareStage(ctx);
    if (options.skipGitCommit && !options.skipGit) {
      ctx.output.git.committed = !!input.commitMessage;
      ctx.output.git.tags = [...input.tags];
    } else if (!options.skipGit) {
      await runGitCommitStage(ctx);
    }
    if (!options.skipPublish) {
      if (options.registry === "all" || options.registry === "npm") {
        await runNpmPublishStage(ctx);
      }
      if (options.registry === "all" || options.registry === "cargo") {
        await runCargoPublishStage(ctx);
      }
      ctx.output.publishSucceeded = ctx.output.npm.every((r) => r.success) && ctx.output.cargo.every((r) => r.success);
    }
    if (!options.skipVerification && !options.skipPublish) {
      await runVerifyStage(ctx);
    }
    if (!options.skipGit && (options.skipPublish || ctx.output.publishSucceeded)) {
      await runGitPushStage(ctx);
    }
    if (!options.skipGithubRelease && ctx.output.git.pushed) {
      await runGithubReleaseStage(ctx);
    }
  } catch (error) {
    const stageName = inferStageName(error);
    const message = error instanceof Error ? error.message : String(error);
    throw new PipelineError(message, stageName, ctx.output, error instanceof Error ? error : void 0);
  }
  return ctx.output;
}
var VersionChangelogEntrySchema = z3.object({
  type: z3.string(),
  description: z3.string(),
  issueIds: z3.array(z3.string()).optional(),
  scope: z3.string().optional(),
  originalType: z3.string().optional()
});
var VersionPackageChangelogSchema = z3.object({
  packageName: z3.string(),
  version: z3.string(),
  previousVersion: z3.string().nullable(),
  revisionRange: z3.string(),
  repoUrl: z3.string().nullable(),
  entries: z3.array(VersionChangelogEntrySchema)
});
var VersionPackageUpdateSchema = z3.object({
  packageName: z3.string(),
  newVersion: z3.string(),
  filePath: z3.string()
});
var VersionOutputSchema = z3.object({
  dryRun: z3.boolean(),
  updates: z3.array(VersionPackageUpdateSchema),
  changelogs: z3.array(VersionPackageChangelogSchema),
  commitMessage: z3.string().optional(),
  tags: z3.array(z3.string())
});
async function parseInput(inputPath) {
  let raw;
  if (inputPath) {
    try {
      raw = fs10.readFileSync(inputPath, "utf-8");
    } catch {
      throw createPublishError("INPUT_PARSE_ERROR", `Could not read file: ${inputPath}`);
    }
  } else {
    raw = await readStdin();
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw createPublishError("INPUT_PARSE_ERROR", "Input is not valid JSON");
  }
  const result = VersionOutputSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw createPublishError("INPUT_VALIDATION_ERROR", `Schema validation failed:
${issues}`);
  }
  if (result.data.updates.length === 0) {
    info("No package updates in version output \u2014 pipeline will be a no-op");
  }
  return result.data;
}
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return chunks.join("");
}
function createPublishCommand() {
  return new Command("publish").description("Publish packages to registries with git tagging and GitHub releases").option("--input <path>", "Path to version output JSON (default: stdin)").option("--config <path>", "Path to releasekit config").option("--registry <type>", "Registry to publish to (npm, cargo, all)", "all").option("--npm-auth <method>", "NPM auth method (oidc, token, auto)", "auto").option("--dry-run", "Simulate all operations", false).option("--skip-git", "Skip git commit/tag/push", false).option("--skip-publish", "Skip registry publishing", false).option("--skip-github-release", "Skip GitHub Release creation", false).option("--skip-verification", "Skip post-publish verification", false).option("--json", "Output results as JSON", false).option("--verbose", "Verbose logging", false).action(async (options) => {
    if (options.verbose) setLogLevel("debug");
    if (options.json) setJsonMode(true);
    try {
      const config = loadConfig2({ configPath: options.config });
      const input = await parseInput(options.input);
      if (options.npmAuth !== "auto") {
        config.npm.auth = options.npmAuth;
      }
      const cliOptions = {
        input: options.input,
        config: options.config,
        registry: options.registry,
        npmAuth: options.npmAuth,
        dryRun: options.dryRun,
        skipGit: options.skipGit,
        skipPublish: options.skipPublish,
        skipGithubRelease: options.skipGithubRelease,
        skipVerification: options.skipVerification,
        json: options.json,
        verbose: options.verbose
      };
      const output = await runPipeline(input, config, cliOptions);
      if (options.json) {
        console.log(JSON.stringify(output, null, 2));
      }
    } catch (err) {
      if (err instanceof PipelineError && options.json) {
        console.log(
          JSON.stringify(
            {
              error: err.message,
              failedStage: err.failedStage,
              partialOutput: err.partialOutput
            },
            null,
            2
          )
        );
        process.exit(EXIT_CODES.PUBLISH_ERROR);
      }
      if (BasePublishError.isPublishError(err)) {
        err.logError();
        process.exit(EXIT_CODES.PUBLISH_ERROR);
      }
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }
  });
}

export {
  parseCargoToml,
  loadConfig2,
  getDefaultConfig2,
  BasePublishError,
  PublishError,
  PipelineError,
  PublishErrorCode,
  createPublishError,
  detectNpmAuth,
  hasCargoAuth,
  updateCargoVersion,
  extractPathDeps,
  isPrerelease,
  getDistTag,
  detectPackageManager,
  runPipeline,
  parseInput,
  createPublishCommand
};
