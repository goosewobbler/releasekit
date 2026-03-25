/**
 * JSON Output service for releasekit-version
 * Centralizes all JSON output handling
 */

import fs from 'node:fs';
import type { VersionChangelogEntry, VersionPackageChangelog } from '@releasekit/core';

export type PackageChangelogData = VersionPackageChangelog;

export interface JsonOutputData {
  dryRun: boolean;
  updates: Array<{
    packageName: string;
    newVersion: string;
    filePath: string;
  }>;
  changelogs: VersionPackageChangelog[];
  sharedEntries?: VersionChangelogEntry[];
  commitMessage?: string;
  tags: string[];
}

// Flag to control JSON output mode
let _jsonOutputMode = false;

// Pending file writes captured during a dryRun pass
const _pendingWrites: Array<{ path: string; content: string }> = [];

// Store collected information for JSON output
const _jsonData: JsonOutputData = {
  dryRun: false,
  updates: [],
  changelogs: [],
  sharedEntries: undefined,
  tags: [],
};

/**
 * Enable JSON output mode
 * @param dryRun Whether this is a dry run
 */
export function enableJsonOutput(dryRun = false): void {
  _jsonOutputMode = true;
  _jsonData.dryRun = dryRun;
  _jsonData.updates = [];
  _jsonData.changelogs = [];
  _jsonData.sharedEntries = undefined;
  _jsonData.tags = [];
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
 * Add a package update to the JSON output
 */
export function addPackageUpdate(packageName: string, newVersion: string, filePath: string): void {
  if (!_jsonOutputMode) return;

  _jsonData.updates.push({
    packageName,
    newVersion,
    filePath,
  });
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
 * Set the commit message in the JSON output
 */
export function setCommitMessage(message: string): void {
  if (!_jsonOutputMode) return;

  _jsonData.commitMessage = message;
}

/**
 * Get the current JSON output data (for testing)
 */
export function getJsonData(): JsonOutputData {
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
