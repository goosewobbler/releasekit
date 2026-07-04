/**
 * JSON Output service for releasekit-version
 * Centralizes all JSON output handling
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  deriveReleaseChannel,
  type VersionAction,
  type VersionChangelogEntry,
  type VersionOutput,
  type VersionPackageChangelog,
} from '@releasekit/core';

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
 *
 * A hybrid package (one directory carrying both a `package.json` and a native manifest like
 * `Cargo.toml`/`pubspec.yaml`) is a SINGLE package — npm owns its identity. Every strategy writes the
 * `package.json` first, then syncs the sibling native manifest to the same version; that second write
 * must not register a second update under the crate/pub name, or the package surfaces twice
 * downstream — a phantom selection row / extra changelog entry under its crate name (#476). Dedupe by
 * directory, mirroring discovery's dir-keyed merge (`mergePackageLists`): npm wins, so a `package.json`
 * supersedes a previously-recorded native sibling and a native sibling is dropped once a `package.json`
 * for the same directory exists.
 */
export function addPackageUpdate(packageName: string, newVersion: string, filePath: string, isRoot?: boolean): void {
  if (!_jsonOutputMode) return;

  // Channel is derived per-package from the resolved version (#485) so every consumer (preview,
  // standing PR, #486/#487) reads a single authoritative value rather than re-deriving it.
  const update = {
    packageName,
    newVersion,
    filePath,
    channel: deriveReleaseChannel(newVersion),
    ...(isRoot ? { isRoot } : {}),
  };
  // Resolve to an absolute path before keying so a mix of absolute and relative filePaths for the
  // same directory still dedupes (callers don't all pass the same path form for every manifest write).
  const dir = path.dirname(path.resolve(filePath));
  const existingIndex = _jsonData.updates.findIndex((u) => path.dirname(path.resolve(u.filePath)) === dir);
  if (existingIndex !== -1) {
    // Only let an incoming package.json replace an already-recorded native sibling; otherwise keep
    // the existing record (the package.json, or the first native manifest) and drop this duplicate.
    const incomingIsPackageJson = path.basename(filePath) === 'package.json';
    const existingIsPackageJson = path.basename(_jsonData.updates[existingIndex].filePath) === 'package.json';
    if (incomingIsPackageJson && !existingIsPackageJson) {
      _jsonData.updates[existingIndex] = update;
    }
    return;
  }

  _jsonData.updates.push(update);
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
 * Record the resolved version action (#420) on a package update — `graduated` / `bumped` /
 * `first-release` plus a short human reason. Purely additive observability; never affects the
 * resolved version. Called by each strategy after the update record exists. No-op when the update
 * isn't found (mirrors the other setPackageUpdate* helpers).
 */
export function setPackageUpdateAction(packageName: string, action: VersionAction, reason: string): void {
  if (!_jsonOutputMode) return;
  const update = _jsonData.updates.find((u) => u.packageName === packageName);
  if (update) {
    update.action = action;
    update.actionReason = reason;
  }
}

/**
 * Record the resolved baseline version (#520) on a package update — the prior release it bumped from,
 * in the same consumer-tag display form the changelog carries. `null` (an unreachable / all-history
 * baseline, or a first release) leaves the field absent so consumers skip the bump delta. Called by
 * each strategy after the update record exists; no-op when the update isn't found (mirrors the other
 * setPackageUpdate* helpers).
 */
export function setPackageUpdatePreviousVersion(packageName: string, previousVersion: string | null): void {
  if (!_jsonOutputMode || previousVersion === null) return;
  const update = _jsonData.updates.find((u) => u.packageName === packageName);
  if (update) update.previousVersion = previousVersion;
}

/**
 * Record the same resolved version action (#420) on every package update. Used by the sync strategy,
 * where all packages move in lockstep to the same version against the same baseline, so the action
 * is identical across the whole unit. Owns the iteration internally so callers don't read back the
 * (otherwise-private) update list.
 */
export function setAllPackageUpdateActions(action: VersionAction, reason: string): void {
  if (!_jsonOutputMode) return;
  for (const update of _jsonData.updates) {
    update.action = action;
    update.actionReason = reason;
  }
}

/**
 * Record the same resolved baseline version (#520) on every package update. Used by the sync strategy,
 * where all packages move in lockstep from the same baseline. `null` (unreachable / all-history) leaves
 * the field absent everywhere. Owns the iteration internally, mirroring {@link setAllPackageUpdateActions}.
 */
export function setAllPackageUpdatePreviousVersions(previousVersion: string | null): void {
  if (!_jsonOutputMode || previousVersion === null) return;
  for (const update of _jsonData.updates) {
    update.previousVersion = previousVersion;
  }
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
