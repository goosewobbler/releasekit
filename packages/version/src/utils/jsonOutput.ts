import fs from 'node:fs';
import path from 'node:path';
import {
  deriveReleaseChannel,
  successEnvelope,
  type VersionAction,
  type VersionChangelogEntry,
  type VersionOutput,
  type VersionPackageChangelog,
  writeEnvelope,
} from '@releasekit/core';

/** @deprecated Use {@link VersionOutput} from `@releasekit/core` instead. */
export type JsonOutputData = VersionOutput;

let _jsonOutputMode = false;

const _pendingWrites: Array<{ path: string; content: string }> = [];

const _jsonData: VersionOutput = {
  dryRun: false,
  strategy: undefined,
  updates: [],
  changelogs: [],
  sharedEntries: undefined,
  tags: [],
  baselineTags: undefined,
};

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

/** Dry-run writes are buffered here and applied later via flushPendingWrites. */
export function recordPendingWrite(path: string, content: string): void {
  if (!_jsonOutputMode) {
    return;
  }
  _pendingWrites.push({ path, content });
}

export function flushPendingWrites(): string[] {
  const written = new Set<string>();
  try {
    for (const { path, content } of _pendingWrites) {
      fs.writeFileSync(path, content);
      written.add(path);
    }
  } finally {
    _pendingWrites.length = 0;
  }
  return [...written];
}

export function getPendingWriteCount(): number {
  return _pendingWrites.length;
}

export function isJsonOutputMode(): boolean {
  return _jsonOutputMode;
}

/** Lets consumers (preview, standing PR) render sync releases as a single versioned unit. */
export function setVersioningStrategy(strategy: 'sync' | 'single' | 'async' | 'group'): void {
  if (!_jsonOutputMode) {
    return;
  }
  _jsonData.strategy = strategy;
}

/**
 * A hybrid package (`package.json` & a native manifest in one directory) is a single package, so updates
 * are deduped by directory with npm winning, mirroring discovery's `mergePackageLists` - otherwise the
 * native sibling's write surfaces it twice downstream under its crate/pub name.
 */
export function addPackageUpdate(packageName: string, newVersion: string, filePath: string, isRoot?: boolean): void {
  if (!_jsonOutputMode) {
    return;
  }

  // Derived once here so consumers (preview, standing PR) read one authoritative value.
  const update = {
    packageName,
    newVersion,
    filePath,
    channel: deriveReleaseChannel(newVersion),
    ...(isRoot ? { isRoot } : {}),
  };
  // Callers mix absolute and relative paths, so resolve before keying.
  const dir = path.dirname(path.resolve(filePath));
  const existingIndex = _jsonData.updates.findIndex((u) => path.dirname(path.resolve(u.filePath)) === dir);
  if (existingIndex !== -1) {
    const incomingIsPackageJson = path.basename(filePath) === 'package.json';
    const existingIsPackageJson = path.basename(_jsonData.updates[existingIndex].filePath) === 'package.json';
    if (incomingIsPackageJson && !existingIsPackageJson) {
      _jsonData.updates[existingIndex] = update;
    }
    return;
  }

  _jsonData.updates.push(update);
}

export function setPackageUpdateTag(packageName: string, tag: string): void {
  if (!_jsonOutputMode) {
    return;
  }
  const update = _jsonData.updates.find((u) => u.packageName === packageName);
  if (update) {
    update.tag = tag;
  }
}

/** Lets CI surfaces treat a fixed group atomically. */
export function setPackageUpdateGroup(packageName: string, group: string): void {
  if (!_jsonOutputMode) {
    return;
  }
  const update = _jsonData.updates.find((u) => u.packageName === packageName);
  if (update) {
    update.group = group;
  }
}

export function setPackageUpdateAction(packageName: string, action: VersionAction, reason: string): void {
  if (!_jsonOutputMode) {
    return;
  }
  const update = _jsonData.updates.find((u) => u.packageName === packageName);
  if (update) {
    update.action = action;
    update.actionReason = reason;
  }
}

/** `null` leaves the field absent so consumers skip the bump delta. */
export function setPackageUpdatePreviousVersion(packageName: string, previousVersion: string | null): void {
  if (!_jsonOutputMode || previousVersion === null) {
    return;
  }
  const update = _jsonData.updates.find((u) => u.packageName === packageName);
  if (update) {
    update.previousVersion = previousVersion;
  }
}

export function setAllPackageUpdateActions(action: VersionAction, reason: string): void {
  if (!_jsonOutputMode) {
    return;
  }
  for (const update of _jsonData.updates) {
    update.action = action;
    update.actionReason = reason;
  }
}

export function setAllPackageUpdatePreviousVersions(previousVersion: string | null): void {
  if (!_jsonOutputMode || previousVersion === null) {
    return;
  }
  for (const update of _jsonData.updates) {
    update.previousVersion = previousVersion;
  }
}

export function tagPrerequisiteRoles(overrideScope: string[], prerequisiteOf: Record<string, string[]>): void {
  if (!_jsonOutputMode) {
    return;
  }
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

export function addChangelogData(data: VersionPackageChangelog): void {
  if (!_jsonOutputMode) {
    return;
  }

  _jsonData.changelogs.push(data);
}

/** Repo-level / CI / shared-package entries that belong to no specific package. */
export function setSharedEntries(entries: VersionChangelogEntry[]): void {
  if (!_jsonOutputMode) {
    return;
  }
  _jsonData.sharedEntries = entries.length > 0 ? entries : undefined;
}

export function addTag(tag: string): void {
  if (!_jsonOutputMode) {
    return;
  }

  _jsonData.tags.push(tag);
}

/** Pushed alongside the consumer tags but excluded from GitHub Release creation. */
export function addBaselineTag(tag: string): void {
  if (!_jsonOutputMode) {
    return;
  }

  if (!_jsonData.baselineTags) {
    _jsonData.baselineTags = [];
  }
  _jsonData.baselineTags.push(tag);
}

export function setCommitMessage(message: string): void {
  if (!_jsonOutputMode) {
    return;
  }

  _jsonData.commitMessage = message;
}

export function getJsonData(): VersionOutput {
  return { ..._jsonData };
}

export function printJsonOutput(outputPath?: string): void {
  if (!_jsonOutputMode) {
    return;
  }
  writeEnvelope(successEnvelope(_jsonData, { changed: !_jsonData.dryRun && _jsonData.updates.length > 0 }), {
    json: true,
    output: outputPath,
  });
}
