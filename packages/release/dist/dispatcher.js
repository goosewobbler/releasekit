#!/usr/bin/env node
import {createRequire as __createRequire} from 'module';
var require = __createRequire(import.meta.url);

// src/dispatcher.ts
import { realpathSync } from "fs";
import { fileURLToPath as fileURLToPath2 } from "url";

// ../core/dist/index.js
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";
function readPackageVersion(importMetaUrl) {
  try {
    const dir = path.dirname(fileURLToPath(importMetaUrl));
    const packageJsonPath = path.resolve(dir, "../package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    return packageJson.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
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
function setQuietMode(quiet) {
  quietMode = quiet;
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
function error(message) {
  log(message, "error");
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

// src/dispatcher.ts
import { createNotesCommand } from "@releasekit/notes";
import { createPublishCommand } from "@releasekit/publish";
import { createVersionCommand } from "@releasekit/version";
import { Command as Command4 } from "commander";

// src/init-command.ts
import * as fs2 from "fs";
import { detectMonorepo } from "@releasekit/notes";
import { Command } from "commander";
function createInitCommand() {
  return new Command("init").description("Create a default releasekit.config.json").option("-f, --force", "Overwrite existing config").action((options) => {
    const configPath = "releasekit.config.json";
    if (fs2.existsSync(configPath) && !options.force) {
      error(`Config file already exists at ${configPath}. Use --force to overwrite.`);
      process.exit(EXIT_CODES.GENERAL_ERROR);
    } else {
      let changelogMode;
      try {
        const detected = detectMonorepo(process.cwd());
        changelogMode = detected.isMonorepo ? "packages" : "root";
        info(
          detected.isMonorepo ? "Monorepo detected \u2014 using mode: packages" : "Single-package repo detected \u2014 using mode: root"
        );
      } catch {
        changelogMode = "root";
        info("Could not detect project type \u2014 using mode: root");
      }
      let packageName;
      try {
        const pkg = JSON.parse(fs2.readFileSync("package.json", "utf-8"));
        packageName = pkg.name;
      } catch {
      }
      const isScoped = packageName?.startsWith("@") ?? false;
      const defaultConfig = {
        $schema: "https://goosewobbler.github.io/releasekit/schema.json",
        notes: {
          changelog: {
            mode: changelogMode
          }
        },
        publish: {
          npm: {
            enabled: true,
            ...isScoped ? { access: "public" } : {}
          }
        }
      };
      fs2.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), "utf-8");
      success(`Created ${configPath}`);
    }
  });
}

// src/preview-command.ts
import { Command as Command2 } from "commander";

// ../config/dist/index.js
import * as TOML from "smol-toml";
import * as fs3 from "fs";
import * as path3 from "path";
import { z as z2 } from "zod";
import { z } from "zod";
import * as fs22 from "fs";
import * as os from "os";
import * as path2 from "path";
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
    const expandedPath = filePath.startsWith("~") ? path2.join(os.homedir(), filePath.slice(1)) : filePath;
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
var AUTH_DIR = path2.join(os.homedir(), ".config", "releasekit");
var AUTH_FILE = path2.join(AUTH_DIR, "auth.json");
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
  } catch (error2) {
    if (error2 instanceof z2.ZodError) {
      const issues = error2.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
      throw new ConfigError(`Config validation errors:
${issues}`);
    }
    if (error2 instanceof SyntaxError) {
      throw new ConfigError(`Invalid JSON in config file: ${error2.message}`);
    }
    throw error2;
  }
}
function loadConfig(options) {
  const cwd = options?.cwd ?? process.cwd();
  const configPath = options?.configPath ?? path3.join(cwd, CONFIG_FILE);
  return loadConfigFile(configPath);
}
function loadCIConfig(options) {
  const config = loadConfig(options);
  return config.ci;
}

// src/preview-context.ts
import * as fs4 from "fs";
function resolvePreviewContext(opts) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN environment variable is required");
  }
  const prNumber = resolvePRNumber(opts.pr);
  const { owner, repo } = resolveRepo(opts.repo);
  return { prNumber, owner, repo, token };
}
function resolvePRNumber(cliValue) {
  if (cliValue) {
    const num = Number.parseInt(cliValue, 10);
    if (Number.isNaN(num) || num <= 0) {
      throw new Error(`Invalid PR number: ${cliValue}`);
    }
    return num;
  }
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && fs4.existsSync(eventPath)) {
    try {
      const event = JSON.parse(fs4.readFileSync(eventPath, "utf-8"));
      if (event.pull_request?.number) {
        return event.pull_request.number;
      }
    } catch {
    }
  }
  throw new Error("Could not determine PR number. Use --pr <number> or run in a GitHub Actions pull_request workflow.");
}
function resolveRepo(cliValue) {
  const repoStr = cliValue ?? process.env.GITHUB_REPOSITORY;
  if (!repoStr) {
    throw new Error("Could not determine repository. Use --repo <owner/repo> or run in a GitHub Actions workflow.");
  }
  const parts = repoStr.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repository format: ${repoStr}. Expected "owner/repo".`);
  }
  return { owner: parts[0], repo: parts[1] };
}

// src/preview-detect.ts
import * as fs5 from "fs";
import * as path4 from "path";
function detectPrerelease(packagePaths, projectDir) {
  const paths = packagePaths.length > 0 ? packagePaths.map((p) => path4.join(projectDir, p, "package.json")) : [path4.join(projectDir, "package.json")];
  for (const pkgPath of paths) {
    if (!fs5.existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(fs5.readFileSync(pkgPath, "utf-8"));
      const result = parsePrerelease(pkg.version);
      if (result.isPrerelease) return result;
    } catch {
    }
  }
  return { isPrerelease: false };
}
function parsePrerelease(version) {
  if (!version) return { isPrerelease: false };
  const match = version.match(/-([a-zA-Z0-9][a-zA-Z0-9-]*)(?:\.\d+)*(?:\+[^\s]+)?$/);
  if (match) {
    return { isPrerelease: true, identifier: match[1] };
  }
  return { isPrerelease: false };
}

// src/preview-format.ts
var MARKER = "<!-- releasekit-preview -->";
var FOOTER = "*Updated automatically by [ReleaseKit](https://github.com/goosewobbler/releasekit)*";
var TYPE_LABELS = {
  added: "Added",
  changed: "Changed",
  fixed: "Fixed",
  security: "Security",
  docs: "Documentation",
  chore: "Chores",
  test: "Tests",
  feat: "Features",
  fix: "Bug Fixes",
  perf: "Performance",
  refactor: "Refactoring",
  style: "Styles",
  build: "Build",
  ci: "CI",
  revert: "Reverts"
};
function getNoChangesMessage(strategy) {
  switch (strategy) {
    case "manual":
      return "Run the release workflow manually if a release is needed.";
    case "direct":
      return "Merging this PR will not trigger a release.";
    case "standing-pr":
      return "Merging this PR will not affect the release PR.";
    case "scheduled":
      return "These changes will not be included in the next scheduled release.";
    default:
      return "";
  }
}
function getIntroMessage(strategy, standingPrNumber) {
  switch (strategy) {
    case "direct":
      return "This PR will trigger the following release when merged:";
    case "standing-pr":
      return standingPrNumber ? `These changes will be added to the release PR (#${standingPrNumber}) when merged:` : "Merging this PR will create a new release PR with the following changes:";
    case "scheduled":
      return "These changes will be included in the next scheduled release:";
    default:
      return "If released, this PR would include:";
  }
}
function getLabelBanner(labelContext) {
  if (!labelContext) return [];
  if (labelContext.trigger === "commit") {
    if (labelContext.skip) {
      return ["> **Warning:** This PR is marked to skip release.", ""];
    }
    if (labelContext.bumpLabel === "major") {
      return ["> **Important:** This PR is labeled for a **major** release.", ""];
    }
  }
  if (labelContext.trigger === "label") {
    if (labelContext.noBumpLabel) {
      const labels = labelContext.labels;
      const labelExamples = labels ? `\`${labels.patch}\`, \`${labels.minor}\`, or \`${labels.major}\`` : "a release label (e.g., `release:patch`, `release:minor`, `release:major`)";
      return ["> No release label detected.", `> **Note:** Add ${labelExamples} to trigger a release.`, ""];
    }
    if (labelContext.bumpLabel) {
      return [`> This PR is labeled for a **${labelContext.bumpLabel}** release.`, ""];
    }
  }
  return [];
}
function formatPreviewComment(result, options) {
  const strategy = options?.strategy ?? "direct";
  const labelContext = options?.labelContext;
  const lines = [MARKER, ""];
  const banner = getLabelBanner(labelContext);
  if (!result) {
    lines.push("<details>", "<summary><b>Release Preview</b> \u2014 no release</summary>", "");
    lines.push(...banner);
    if (!labelContext?.noBumpLabel) {
      lines.push(`> **Note:** No releasable changes detected. ${getNoChangesMessage(strategy)}`);
    }
    lines.push("", "---", FOOTER, "</details>");
    return lines.join("\n");
  }
  const { versionOutput } = result;
  const pkgCount = versionOutput.updates.length;
  const pkgSummary = pkgCount === 1 ? `${versionOutput.updates[0]?.packageName} ${versionOutput.updates[0]?.newVersion}` : `${pkgCount} packages`;
  lines.push("<details>", `<summary><b>Release Preview</b> \u2014 ${pkgSummary}</summary>`, "");
  lines.push(...banner);
  lines.push(getIntroMessage(strategy, options?.standingPrNumber), "");
  lines.push("### Packages", "");
  lines.push("| Package | Version |", "|---------|---------|");
  for (const update of versionOutput.updates) {
    lines.push(`| \`${update.packageName}\` | ${update.newVersion} |`);
  }
  lines.push("");
  const sharedEntries = versionOutput.sharedEntries?.length ? versionOutput.sharedEntries : void 0;
  const hasPackageChangelogs = versionOutput.changelogs.some((cl) => cl.entries.length > 0);
  if (sharedEntries || hasPackageChangelogs) {
    lines.push("### Changelog", "");
    if (sharedEntries) {
      lines.push("<details>", "<summary><b>Project-wide changes</b></summary>", "");
      lines.push(...renderEntries(sharedEntries));
      lines.push("</details>", "");
    }
    for (const changelog of versionOutput.changelogs) {
      if (changelog.entries.length > 0) {
        lines.push(...formatPackageChangelog(changelog));
      }
    }
  }
  if (versionOutput.tags.length > 0) {
    lines.push("### Tags", "");
    for (const tag of versionOutput.tags) {
      lines.push(`- \`${tag}\``);
    }
    lines.push("");
  }
  lines.push("---", FOOTER, "</details>");
  return lines.join("\n");
}
function renderEntries(entries) {
  const lines = [];
  const grouped = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    if (!grouped.has(entry.type)) grouped.set(entry.type, []);
    grouped.get(entry.type)?.push(entry);
  }
  const renderedTypes = /* @__PURE__ */ new Set();
  for (const type of Object.keys(TYPE_LABELS)) {
    const group = grouped.get(type);
    if (group && group.length > 0) {
      lines.push(...formatEntryGroup(type, group));
      renderedTypes.add(type);
    }
  }
  for (const [type, group] of grouped) {
    if (!renderedTypes.has(type) && group.length > 0) {
      lines.push(...formatEntryGroup(type, group));
    }
  }
  return lines;
}
function formatPackageChangelog(changelog) {
  const lines = [];
  const prevVersion = changelog.previousVersion ?? "N/A";
  const summary = `<b>${changelog.packageName}</b> ${prevVersion} \u2192 ${changelog.version}`;
  lines.push("<details>", `<summary>${summary}</summary>`, "");
  lines.push(...renderEntries(changelog.entries));
  lines.push("</details>", "");
  return lines;
}
function formatEntryGroup(type, entries) {
  const label = TYPE_LABELS[type] ?? capitalize(type);
  const lines = [`#### ${label}`, ""];
  for (const entry of entries) {
    let line = `- ${entry.description}`;
    if (entry.scope) {
      line += ` (\`${entry.scope}\`)`;
    }
    if (entry.issueIds && entry.issueIds.length > 0) {
      line += ` ${entry.issueIds.join(", ")}`;
    }
    lines.push(line);
  }
  lines.push("");
  return lines;
}
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// src/preview-github.ts
import { Octokit } from "@octokit/rest";
function createOctokit(token) {
  return new Octokit({ auth: token });
}
async function findPreviewComment(octokit, owner, repo, prNumber) {
  const iterator = octokit.paginate.iterator(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100
  });
  for await (const response of iterator) {
    for (const comment of response.data) {
      if (comment.body?.startsWith(MARKER)) {
        return comment.id;
      }
    }
  }
  return null;
}
async function fetchPRLabels(octokit, owner, repo, prNumber) {
  const { data } = await octokit.rest.issues.get({
    owner,
    repo,
    issue_number: prNumber
  });
  return (data.labels ?? []).map((label) => typeof label === "string" ? label : label.name ?? "");
}
async function postOrUpdateComment(octokit, owner, repo, prNumber, body) {
  const existingId = await findPreviewComment(octokit, owner, repo, prNumber);
  if (existingId) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existingId,
      body
    });
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body
    });
  }
}

// src/release.ts
import { execSync } from "child_process";
function getHeadCommitMessage(cwd) {
  try {
    return execSync("git log -1 --pretty=%s", { encoding: "utf-8", cwd }).trim();
  } catch {
    return null;
  }
}
async function runRelease(inputOptions) {
  const options = { ...inputOptions };
  if (options.verbose) setLogLevel("debug");
  if (options.quiet) setQuietMode(true);
  if (options.json) setJsonMode(true);
  let releaseKitConfig;
  try {
    releaseKitConfig = loadConfig({ cwd: options.projectDir, configPath: options.config });
  } catch (err) {
    error(`Failed to load release config: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
  const releaseConfig = releaseKitConfig.release;
  if (releaseConfig?.ci?.skipPatterns?.length) {
    const headCommit = getHeadCommitMessage(options.projectDir);
    if (headCommit) {
      const matchedPattern = releaseConfig.ci.skipPatterns.find((p) => headCommit.startsWith(p));
      if (matchedPattern) {
        info(`Skipping release: commit message matches skip pattern "${matchedPattern}"`);
        return null;
      }
    }
  }
  if (releaseConfig?.steps) {
    if (!releaseConfig.steps.includes("notes") && !options.skipNotes) {
      options.skipNotes = true;
    }
    if (!releaseConfig.steps.includes("publish") && !options.skipPublish) {
      options.skipPublish = true;
    }
  }
  if (releaseConfig?.ci?.notes === false && !options.skipNotes) {
    options.skipNotes = true;
  }
  if (releaseConfig?.ci?.githubRelease === false && !options.skipGithubRelease) {
    options.skipGithubRelease = true;
  }
  info("Running version analysis...");
  const versionOutput = await runVersionStep({ ...options, dryRun: true });
  versionOutput.dryRun = options.dryRun ?? false;
  if (versionOutput.updates.length === 0) {
    info("No releasable changes found");
    return null;
  }
  if (releaseConfig?.ci?.minChanges !== void 0 && versionOutput.updates.length < releaseConfig.ci.minChanges) {
    info(
      `Skipping release: ${versionOutput.updates.length} package(s) to update, minimum is ${releaseConfig.ci.minChanges}`
    );
    return null;
  }
  if (!options.dryRun) {
    const { flushPendingWrites } = await import("@releasekit/version");
    flushPendingWrites();
  }
  info(`Found ${versionOutput.updates.length} package update(s)`);
  for (const update of versionOutput.updates) {
    info(`  ${update.packageName} \u2192 ${update.newVersion}`);
  }
  let notesGenerated = false;
  let packageNotes;
  let releaseNotes;
  let notesFiles = [];
  if (!options.skipNotes) {
    info("Generating release notes...");
    const notesResult = await runNotesStep(versionOutput, options);
    packageNotes = notesResult.packageNotes;
    releaseNotes = notesResult.releaseNotes;
    notesFiles = notesResult.files;
    notesGenerated = true;
    success("Release notes generated");
  }
  let publishOutput;
  if (!options.skipPublish) {
    info("Publishing...");
    publishOutput = await runPublishStep(versionOutput, options, releaseNotes, notesFiles);
    success("Publish complete");
  }
  return { versionOutput, notesGenerated, packageNotes, releaseNotes, publishOutput };
}
async function runVersionStep(options) {
  const { loadConfig: loadConfig2, VersionEngine, enableJsonOutput, getJsonData } = await import("@releasekit/version");
  enableJsonOutput(options.dryRun);
  const config = loadConfig2({ cwd: options.projectDir, configPath: options.config });
  if (options.dryRun) config.dryRun = true;
  if (options.sync) config.sync = true;
  if (options.bump) config.type = options.bump;
  if (options.prerelease) {
    config.prereleaseIdentifier = options.prerelease === true ? "next" : options.prerelease;
    config.isPrerelease = true;
  }
  const cliTargets = options.target ? options.target.split(",").map((t) => t.trim()) : [];
  if (cliTargets.length > 0) {
    config.packages = cliTargets;
  }
  const engine = new VersionEngine(config);
  const pkgsResult = await engine.getWorkspacePackages();
  const resolvedCount = pkgsResult.packages.length;
  if (resolvedCount === 0) {
    throw new Error("No packages found in workspace");
  }
  if (config.sync) {
    engine.setStrategy("sync");
    await engine.run(pkgsResult);
  } else if (resolvedCount === 1) {
    engine.setStrategy("single");
    await engine.run(pkgsResult);
  } else {
    engine.setStrategy("async");
    await engine.run(pkgsResult, cliTargets);
  }
  return getJsonData();
}
async function runNotesStep(versionOutput, options) {
  const { parseVersionOutput, runPipeline, loadConfig: loadConfig2 } = await import("@releasekit/notes");
  const config = loadConfig2(options.projectDir, options.config);
  const input = parseVersionOutput(JSON.stringify(versionOutput));
  const result = await runPipeline(input, config, options.dryRun);
  return { packageNotes: result.packageNotes, releaseNotes: result.releaseNotes, files: result.files };
}
async function runPublishStep(versionOutput, options, releaseNotes, additionalFiles) {
  const { runPipeline, loadConfig: loadConfig2 } = await import("@releasekit/publish");
  const config = loadConfig2({ configPath: options.config });
  if (options.branch) {
    config.git.branch = options.branch;
  }
  const publishOptions = {
    dryRun: options.dryRun,
    registry: "all",
    npmAuth: options.npmAuth ?? "auto",
    skipGit: options.skipGit,
    skipPublish: false,
    skipGithubRelease: options.skipGithubRelease,
    skipVerification: options.skipVerification,
    json: options.json,
    verbose: options.verbose,
    releaseNotes,
    additionalFiles
  };
  return runPipeline(versionOutput, config, publishOptions);
}

// src/preview.ts
var DEFAULT_LABELS = {
  stable: "release:stable",
  prerelease: "release:prerelease",
  skip: "release:skip",
  major: "release:major",
  minor: "release:minor",
  patch: "release:patch"
};
async function runPreview(options) {
  const ciConfig = loadCIConfig({ cwd: options.projectDir, configPath: options.config });
  if (ciConfig?.prPreview === false) {
    info("PR preview is disabled in config (ci.prPreview: false)");
    return;
  }
  let context;
  let octokit;
  if (!options.dryRun) {
    try {
      context = resolvePreviewContext({ pr: options.pr, repo: options.repo });
      octokit = createOctokit(context.token);
    } catch (error2) {
      warn(`Cannot post PR comment: ${error2 instanceof Error ? error2.message : String(error2)}`);
    }
  }
  const { options: effectiveOptions, labelContext } = await applyLabelOverrides(options, ciConfig, context, octokit);
  const strategy = ciConfig?.releaseStrategy ?? "direct";
  let result = null;
  if (!labelContext.noBumpLabel) {
    const releaseConfig = loadConfig({ cwd: effectiveOptions.projectDir, configPath: effectiveOptions.config });
    const prereleaseFlag = resolvePrerelease(
      effectiveOptions,
      releaseConfig.version?.packages ?? [],
      effectiveOptions.projectDir
    );
    info("Analyzing release...");
    result = await runRelease({
      config: effectiveOptions.config,
      dryRun: true,
      sync: false,
      bump: effectiveOptions.bump,
      prerelease: prereleaseFlag,
      skipNotes: true,
      skipPublish: true,
      skipGit: true,
      skipGithubRelease: true,
      skipVerification: true,
      json: false,
      verbose: false,
      quiet: true,
      projectDir: effectiveOptions.projectDir
    });
  } else {
    info("No release label detected \u2014 skipping version analysis");
  }
  const commentBody = formatPreviewComment(result, { strategy, labelContext });
  if (!context || !octokit) {
    console.log(commentBody);
    return;
  }
  info(`Posting preview comment on PR #${context.prNumber}...`);
  await postOrUpdateComment(octokit, context.owner, context.repo, context.prNumber, commentBody);
  success(`Preview comment posted on PR #${context.prNumber}`);
}
function resolvePrerelease(options, packagePaths, projectDir) {
  if (options.stable) {
    return void 0;
  }
  if (options.prerelease !== void 0) {
    return options.prerelease;
  }
  const detected = detectPrerelease(packagePaths, projectDir);
  if (detected.isPrerelease) {
    info(`Detected prerelease version (identifier: ${detected.identifier})`);
    return detected.identifier;
  }
  return void 0;
}
async function applyLabelOverrides(options, ciConfig, context, existingOctokit) {
  const trigger = ciConfig?.releaseTrigger ?? "label";
  const labels = ciConfig?.labels ?? DEFAULT_LABELS;
  const defaultLabelContext = { trigger, skip: false, noBumpLabel: false };
  if (!context) {
    return {
      options,
      labelContext: { ...defaultLabelContext, noBumpLabel: trigger === "label" && !options.bump, labels }
    };
  }
  let prLabels;
  const octokitToUse = existingOctokit ?? createOctokit(context.token);
  try {
    prLabels = await fetchPRLabels(octokitToUse, context.owner, context.repo, context.prNumber);
  } catch {
    warn("Could not fetch PR labels \u2014 skipping label-driven overrides");
    return {
      options,
      labelContext: { ...defaultLabelContext, noBumpLabel: trigger === "label", labels }
    };
  }
  const result = { ...options };
  const labelContext = { trigger, skip: false, noBumpLabel: false, labels };
  if (trigger === "commit") {
    if (prLabels.includes(labels.skip)) {
      info(`PR label "${labels.skip}" detected \u2014 release will be skipped`);
      labelContext.skip = true;
    }
    if (!labelContext.skip && prLabels.includes(labels.major)) {
      info(`PR label "${labels.major}" detected \u2014 forcing major release`);
      labelContext.bumpLabel = "major";
      result.bump = "major";
    }
  } else {
    if (prLabels.includes(labels.major)) {
      info(`PR label "${labels.major}" detected \u2014 major release`);
      labelContext.bumpLabel = "major";
      result.bump = "major";
    } else if (prLabels.includes(labels.minor)) {
      info(`PR label "${labels.minor}" detected \u2014 minor release`);
      labelContext.bumpLabel = "minor";
      result.bump = "minor";
    } else if (prLabels.includes(labels.patch)) {
      info(`PR label "${labels.patch}" detected \u2014 patch release`);
      labelContext.bumpLabel = "patch";
      result.bump = "patch";
    } else {
      labelContext.noBumpLabel = true;
    }
  }
  if (!options.stable && options.prerelease === void 0) {
    if (prLabels.includes(labels.stable)) {
      info(`PR label "${labels.stable}" detected \u2014 using stable release preview`);
      result.stable = true;
    } else if (prLabels.includes(labels.prerelease)) {
      info(`PR label "${labels.prerelease}" detected \u2014 using prerelease preview`);
      result.prerelease = true;
    }
  }
  return { options: result, labelContext: { ...labelContext, labels } };
}

// src/preview-command.ts
function createPreviewCommand() {
  return new Command2("preview").description("Post a release preview comment on the current pull request").option("-c, --config <path>", "Path to config file").option("--project-dir <path>", "Project directory", process.cwd()).option("--pr <number>", "PR number (auto-detected from GitHub Actions)").option("--repo <owner/repo>", "Repository (auto-detected from GITHUB_REPOSITORY)").option("-p, --prerelease [identifier]", "Force prerelease preview (auto-detected by default)").option("--stable", "Force stable release preview (graduation from prerelease)", false).option(
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
    } catch (error2) {
      console.error(error2 instanceof Error ? error2.message : String(error2));
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }
  });
}

// src/release-command.ts
import { Command as Command3, Option } from "commander";
function createReleaseCommand() {
  return new Command3("release").description("Run the full release pipeline").option("-c, --config <path>", "Path to config file").option("-d, --dry-run", "Preview all steps without side effects", false).option("-b, --bump <type>", "Force bump type (patch|minor|major)").option("-p, --prerelease [identifier]", "Create prerelease version").option("-s, --sync", "Use synchronized versioning across all packages", false).option("-t, --target <packages>", "Target specific packages (comma-separated)").option("--branch <name>", "Override the git branch used for push").addOption(new Option("--npm-auth <method>", "NPM auth method").choices(["auto", "oidc", "token"]).default("auto")).option("--skip-notes", "Skip changelog generation", false).option("--skip-publish", "Skip registry publishing and git operations", false).option("--skip-git", "Skip git commit/tag/push", false).option("--skip-github-release", "Skip GitHub release creation", false).option("--skip-verification", "Skip post-publish verification", false).option("-j, --json", "Output results as JSON", false).option("-v, --verbose", "Verbose logging", false).option("-q, --quiet", "Suppress non-error output", false).option("--project-dir <path>", "Project directory", process.cwd()).action(async (opts) => {
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
    } catch (error2) {
      console.error(error2 instanceof Error ? error2.message : String(error2));
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }
  });
}

// src/dispatcher.ts
function createDispatcherProgram() {
  const program = new Command4().name("releasekit").description("Unified release pipeline: version, changelog, and publish").version(readPackageVersion(import.meta.url));
  program.addCommand(createReleaseCommand(), { isDefault: true });
  program.addCommand(createPreviewCommand());
  program.addCommand(createInitCommand());
  program.addCommand(createVersionCommand());
  program.addCommand(createNotesCommand());
  program.addCommand(createPublishCommand());
  return program;
}
var isMain = (() => {
  try {
    return process.argv[1] ? realpathSync(process.argv[1]) === fileURLToPath2(import.meta.url) : false;
  } catch {
    return false;
  }
})();
if (isMain) {
  createDispatcherProgram().parse();
}
export {
  createDispatcherProgram
};
