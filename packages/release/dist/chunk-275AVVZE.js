import {
  init_esm_shims
} from "./chunk-NOZSTVTV.js";

// ../notes/dist/chunk-7TJSPQPW.js
init_esm_shims();
import chalk from "chalk";
import * as fs2 from "fs";
import * as path2 from "path";
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
var TYPE_ORDER = ["added", "changed", "deprecated", "removed", "fixed", "security"];
var TYPE_LABELS = {
  added: "Added",
  changed: "Changed",
  deprecated: "Deprecated",
  removed: "Removed",
  fixed: "Fixed",
  security: "Security"
};
function groupEntriesByType(entries) {
  const grouped = /* @__PURE__ */ new Map();
  for (const type of TYPE_ORDER) {
    grouped.set(type, []);
  }
  for (const entry of entries) {
    const existing = grouped.get(entry.type) ?? [];
    existing.push(entry);
    grouped.set(entry.type, existing);
  }
  return grouped;
}
function formatEntry(entry) {
  let line;
  if (entry.breaking && entry.scope) {
    line = `- **BREAKING** **${entry.scope}**: ${entry.description}`;
  } else if (entry.breaking) {
    line = `- **BREAKING** ${entry.description}`;
  } else if (entry.scope) {
    line = `- **${entry.scope}**: ${entry.description}`;
  } else {
    line = `- ${entry.description}`;
  }
  if (entry.issueIds && entry.issueIds.length > 0) {
    line += ` (${entry.issueIds.join(", ")})`;
  }
  return line;
}
function formatVersion(context, options) {
  const lines = [];
  const versionLabel = options?.includePackageName && context.packageName ? `${context.packageName}@${context.version}` : context.version;
  const versionHeader = context.previousVersion ? `## [${versionLabel}]` : `## ${versionLabel}`;
  lines.push(`${versionHeader} - ${context.date}`);
  lines.push("");
  if (context.compareUrl) {
    lines.push(`[Full Changelog](${context.compareUrl})`);
    lines.push("");
  }
  if (context.enhanced?.summary) {
    lines.push(context.enhanced.summary);
    lines.push("");
  }
  const grouped = groupEntriesByType(context.entries);
  for (const [type, entries] of grouped) {
    if (entries.length === 0) continue;
    lines.push(`### ${TYPE_LABELS[type]}`);
    for (const entry of entries) {
      lines.push(formatEntry(entry));
    }
    lines.push("");
  }
  return lines.join("\n");
}
function formatHeader() {
  return `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`;
}
function renderMarkdown(contexts, options) {
  const sections = [formatHeader()];
  for (const context of contexts) {
    sections.push(formatVersion(context, options));
  }
  return sections.join("\n");
}
function prependVersion(existingPath, context, options) {
  let existing = "";
  if (fs2.existsSync(existingPath)) {
    existing = fs2.readFileSync(existingPath, "utf-8");
    const headerEnd = existing.indexOf("\n## ");
    if (headerEnd >= 0) {
      const header = existing.slice(0, headerEnd);
      const body = existing.slice(headerEnd + 1);
      const newVersion = formatVersion(context, options);
      return `${header}

${newVersion}
${body}`;
    }
  }
  return renderMarkdown([context]);
}
function writeMarkdown(outputPath, contexts, config, dryRun, options) {
  const content = renderMarkdown(contexts, options);
  const label = /changelog/i.test(outputPath) ? "Changelog" : "Release notes";
  if (dryRun) {
    info(`[DRY RUN] ${label} preview (would write to ${outputPath}):`);
    info(content);
    return;
  }
  const dir = path2.dirname(outputPath);
  if (!fs2.existsSync(dir)) {
    fs2.mkdirSync(dir, { recursive: true });
  }
  if (outputPath === "-") {
    process.stdout.write(content);
    return;
  }
  if (config.updateStrategy !== "regenerate" && fs2.existsSync(outputPath) && contexts.length === 1) {
    const firstContext = contexts[0];
    if (firstContext) {
      const updated = prependVersion(outputPath, firstContext, options);
      fs2.writeFileSync(outputPath, updated, "utf-8");
    }
  } else {
    fs2.writeFileSync(outputPath, content, "utf-8");
  }
  success(`${label} written to ${outputPath}`);
}

// ../notes/dist/chunk-F7MUVHZ2.js
init_esm_shims();
import * as fs from "fs";
import * as path from "path";
function splitByPackage(contexts) {
  const byPackage = /* @__PURE__ */ new Map();
  for (const ctx of contexts) {
    byPackage.set(ctx.packageName, ctx);
  }
  return byPackage;
}
function writeFile(outputPath, content, dryRun) {
  if (dryRun) {
    info(`Would write to ${outputPath}`);
    debug(content);
    return false;
  }
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(outputPath, content, "utf-8");
  success(`Changelog written to ${outputPath}`);
  return true;
}
function aggregateToRoot(contexts) {
  const aggregated = {
    packageName: "monorepo",
    version: contexts[0]?.version ?? "0.0.0",
    previousVersion: contexts[0]?.previousVersion ?? null,
    date: (/* @__PURE__ */ new Date()).toISOString().split("T")[0] ?? "",
    repoUrl: contexts[0]?.repoUrl ?? null,
    entries: []
  };
  for (const ctx of contexts) {
    for (const entry of ctx.entries) {
      aggregated.entries.push({
        ...entry,
        scope: entry.scope ? `${ctx.packageName}/${entry.scope}` : ctx.packageName
      });
    }
  }
  return aggregated;
}
function writeMonorepoChangelogs(contexts, options, config, dryRun) {
  const files = [];
  if (options.mode === "root" || options.mode === "both") {
    const rootPath = path.join(options.rootPath, options.fileName ?? "CHANGELOG.md");
    const fmtOpts = { includePackageName: true };
    info(`Writing root changelog to ${rootPath}`);
    let rootContent;
    if (config.updateStrategy !== "regenerate" && fs.existsSync(rootPath)) {
      const newSections = contexts.map((ctx) => formatVersion(ctx, fmtOpts)).join("\n");
      const existing = fs.readFileSync(rootPath, "utf-8");
      const headerEnd = existing.indexOf("\n## ");
      if (headerEnd >= 0) {
        rootContent = `${existing.slice(0, headerEnd)}

${newSections}
${existing.slice(headerEnd + 1)}`;
      } else {
        rootContent = renderMarkdown(contexts, fmtOpts);
      }
    } else {
      rootContent = renderMarkdown(contexts, fmtOpts);
    }
    if (writeFile(rootPath, rootContent, dryRun)) {
      files.push(rootPath);
    }
  }
  if (options.mode === "packages" || options.mode === "both") {
    const byPackage = splitByPackage(contexts);
    const packageDirMap = buildPackageDirMap(options.rootPath, options.packagesPath);
    for (const [packageName, ctx] of byPackage) {
      const simpleName = packageName.split("/").pop();
      const packageDir = packageDirMap.get(packageName) ?? (simpleName ? packageDirMap.get(simpleName) : void 0) ?? null;
      if (packageDir) {
        const changelogPath = path.join(packageDir, options.fileName ?? "CHANGELOG.md");
        info(`Writing changelog for ${packageName} to ${changelogPath}`);
        const pkgContent = config.updateStrategy !== "regenerate" && fs.existsSync(changelogPath) ? prependVersion(changelogPath, ctx) : renderMarkdown([ctx]);
        if (writeFile(changelogPath, pkgContent, dryRun)) {
          files.push(changelogPath);
        }
      } else {
        info(`Could not find directory for package ${packageName}, skipping`);
      }
    }
  }
  return files;
}
function buildPackageDirMap(rootPath, packagesPath) {
  const map = /* @__PURE__ */ new Map();
  const packagesDir = path.join(rootPath, packagesPath);
  if (!fs.existsSync(packagesDir)) {
    return map;
  }
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(packagesDir, entry.name);
    map.set(entry.name, dirPath);
    const packageJsonPath = path.join(dirPath, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
        if (pkg.name) {
          map.set(pkg.name, dirPath);
        }
      } catch {
      }
    }
  }
  return map;
}
function detectMonorepo(cwd) {
  const pnpmWorkspacesPath = path.join(cwd, "pnpm-workspace.yaml");
  const packageJsonPath = path.join(cwd, "package.json");
  if (fs.existsSync(pnpmWorkspacesPath)) {
    const content = fs.readFileSync(pnpmWorkspacesPath, "utf-8");
    const packagesMatch = content.match(/packages:\s*\n\s*-\s*['"]([^'"]+)['"]/);
    if (packagesMatch?.[1]) {
      const packagesGlob = packagesMatch[1];
      const packagesPath = packagesGlob.replace(/\/?\*$/, "").replace(/\/\*\*$/, "");
      return { isMonorepo: true, packagesPath: packagesPath || "packages" };
    }
    return { isMonorepo: true, packagesPath: "packages" };
  }
  if (fs.existsSync(packageJsonPath)) {
    try {
      const content = fs.readFileSync(packageJsonPath, "utf-8");
      const pkg = JSON.parse(content);
      if (pkg.workspaces) {
        const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages;
        if (workspaces?.length) {
          const firstWorkspace = workspaces[0];
          if (firstWorkspace) {
            const packagesPath = firstWorkspace.replace(/\/?\*$/, "").replace(/\/\*\*$/, "");
            return { isMonorepo: true, packagesPath: packagesPath || "packages" };
          }
        }
      }
    } catch {
      return { isMonorepo: false, packagesPath: "" };
    }
  }
  return { isMonorepo: false, packagesPath: "" };
}

export {
  setLogLevel,
  setQuietMode,
  error,
  warn,
  info,
  success,
  debug,
  ReleaseKitError,
  EXIT_CODES,
  formatVersion,
  renderMarkdown,
  writeMarkdown,
  splitByPackage,
  aggregateToRoot,
  writeMonorepoChangelogs,
  detectMonorepo
};
