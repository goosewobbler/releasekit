/**
 * JSON Output service for releasekit-version
 * Centralizes all JSON output handling
 */

import fs from 'node:fs';
import type { VersionChangelogEntry, VersionOutput, VersionPackageChangelog } from '@releasekit/core';

/** @deprecated Use {@link VersionOutput} from `@releasekit/core` instead. */
export type JsonOutputData = VersionOutput;

// Flag to control JSON output mode
let _jsonOutputMode = false;

// Pending file writes captured during a dryRun pass
const _pendingWrites: Array<{ path: string; content: string }> = [];

// Store collected information for JSON output
const _jsonData: VersionOutput = {
  dryRun: false,
  strategy: undefined,
  updates: [],
  changelogs: [],
  sharedEntries: undefined,
  tags: [],
  baselineTags: undefined,
};

/**
 * Enable JSON output mode
 * @param dryRun Whether this is a dry run
 */
export function enableJsonOutput(dryRun = false): void {
  _jsonOutputMode = true;
  _jsonData.dryRun = dryRun;
  _jsonData.strategy = undefined;
  _jsonData.updates = [];
  _jsonData.changelogs = [];
  _jsonData.sharedEntries = undefined;
  _jsonData.tags = [];
  _jsonData.baselineTags = undefined;
  _jsonData.commitMessage = undefined;
  _pendingWrites.length = 0;
}

/**
 * Record a file write to be applied later via flushPendingWrites.
 * Called during dryRun passes in place of writing directly to disk.
 */
export function recordPendingWrite(path: string, content: string): void {
  if (!_jsonOutputMode) return;
  _pendingWrites.push({ path, content });
}

/**
 * Apply all pending writes to disk and clear the buffer.
 */
export function flushPendingWrites(): void {
  try {
    for (const { path, content } of _pendingWrites) {
      fs.writeFileSync(path, content);
    }
  } finally {
    _pendingWrites.length = 0;
  }
}

/**
 * Return the current pending write count (for testing).
 */
export function getPendingWriteCount(): number {
  return _pendingWrites.length;
}

/**
 * Check if JSON output mode is enabled
 */
export function isJsonOutputMode(): boolean {
  return _jsonOutputMode;
}

/**
 * Record which versioning strategy is producing this output so consumers
 * (preview, standing PR) can render sync releases as a single versioned unit.
 */
export function setVersioningStrategy(strategy: 'sync' | 'single' | 'async' | 'group'): void {
  if (!_jsonOutputMode) return;
  _jsonData.strategy = strategy;
}

/**
 * Add a package update to the JSON output
 * @param isRoot True when this is the workspace-root package.json bumped in lockstep (sync mode)
 */
export function addPackageUpdate(packageName: string, newVersion: string, filePath: string, isRoot?: boolean): void {
  if (!_jsonOutputMode) return;

  _jsonData.updates.push({
    packageName,
    newVersion,
    filePath,
    ...(isRoot ? { isRoot } : {}),
  });
}

/**
 * Set the git tag associated with a specific package update.
 * Called after the tag name is computed, to link it back to the update record.
 */
export function setPackageUpdateTag(packageName: string, tag: string): void {
  if (!_jsonOutputMode) return;
  const update = _jsonData.updates.find((u) => u.packageName === packageName);
  if (update) update.tag = tag;
}

/**
 * Tag a package update with the version group it was released as part of.
 * Lets CI surfaces treat a fixed group atomically. Called by the group strategy after the
 * package.json update has been recorded.
 */
export function setPackageUpdateGroup(packageName: string, group: string): void {
  if (!_jsonOutputMode) return;
  const update = _jsonData.updates.find((u) => u.packageName === packageName);
  if (update) update.group = group;
}

/**
 * Tag each package update's role for a `--include-prerequisites` run: a package in `overrideScope`
 * is a `'target'`; one listed in `prerequisiteOf` is a `'prerequisite'` carrying the target(s) it
 * was pulled in for. Updates in neither (e.g. the root lockstep bump) are left untagged. Called by
 * the engine after the strategy has produced the updates.
 */
export function tagPrerequisiteRoles(overrideScope: string[], prerequisiteOf: Record<string, string[]>): void {
  if (!_jsonOutputMode) return;
  const targets = new Set(overrideScope);
  for (const update of _jsonData.updates) {
    if (targets.has(update.packageName)) {
      update.role = 'target';
    } else if (prerequisiteOf[update.packageName]) {
      update.role = 'prerequisite';
      update.prerequisiteOf = prerequisiteOf[update.packageName];
    }
  }
}

/**
 * Add changelog data for a package to the JSON output
 */
export function addChangelogData(data: VersionPackageChangelog): void {
  if (!_jsonOutputMode) return;

  _jsonData.changelogs.push(data);
}

/**
 * Set the shared changelog entries (repo-level / CI / shared-package commits)
 * that don't belong to any specific package.
 */
export function setSharedEntries(entries: VersionChangelogEntry[]): void {
  if (!_jsonOutputMode) return;
  _jsonData.sharedEntries = entries.length > 0 ? entries : undefined;
}

/**
 * Add a tag to the JSON output
 */
export function addTag(tag: string): void {
  if (!_jsonOutputMode) return;

  _jsonData.tags.push(tag);
}

/**
 * Add a baseline tag (internal-only marker) to the JSON output. Pushed alongside the
 * consumer tags but excluded from GitHub Release creation.
 */
export function addBaselineTag(tag: string): void {
  if (!_jsonOutputMode) return;

  if (!_jsonData.baselineTags) _jsonData.baselineTags = [];
  _jsonData.baselineTags.push(tag);
}

/**
 * Set the commit message in the JSON output
 */
export function setCommitMessage(message: string): void {
  if (!_jsonOutputMode) return;

  _jsonData.commitMessage = message;
}

/**
 * Get the current JSON output data (for testing)
 */
export function getJsonData(): VersionOutput {
  return { ..._jsonData };
}

/**
 * Print JSON output at the end of execution
 */
export function printJsonOutput(): void {
  if (_jsonOutputMode) {
    console.log(JSON.stringify(_jsonData, null, 2));
  }
}
