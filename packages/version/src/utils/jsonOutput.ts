/**
 * JSON Output service for releasekit-version
 * Centralizes all JSON output handling
 */

import type { ChangelogEntry } from '../changelog/changelogManager.js';

export interface PackageChangelogData {
  packageName: string;
  version: string;
  previousVersion: string | null;
  revisionRange: string;
  repoUrl: string | null;
  entries: ChangelogEntry[];
}

/**
 * JSON output data structure
 */
export interface JsonOutputData {
  dryRun: boolean;
  updates: Array<{
    packageName: string;
    newVersion: string;
    filePath: string;
  }>;
  changelogs: PackageChangelogData[];
  commitMessage?: string;
  tags: string[];
}

// Flag to control JSON output mode
let _jsonOutputMode = false;

// Store collected information for JSON output
const _jsonData: JsonOutputData = {
  dryRun: false,
  updates: [],
  changelogs: [],
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
  _jsonData.tags = [];
  _jsonData.commitMessage = undefined;
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
export function addChangelogData(data: PackageChangelogData): void {
  if (!_jsonOutputMode) return;

  _jsonData.changelogs.push(data);
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
