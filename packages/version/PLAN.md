# Plan: Extract Changelog Generation to Separate Tool

## Overview

This plan outlines the removal of changelog formatting and file-writing functionality from `package-versioner`. Changelog generation will move to a separate tool (`changelog-creator`) that consumes the JSON output from `package-versioner`.

## Rationale

| Aspect | Before (Integrated) | After (Separated) |
|--------|---------------------|-------------------|
| LLM dependency | Would pollute versioning tool | Isolated in changelog tool |
| Template system | Hardcoded, limited | Full flexibility in new tool |
| Release cadence | Coupled | Independent |
| Reusability | Tied to package-versioner | Works with any JSON source |
| Code complexity | Mixed concerns | Clear separation |

## What Stays in package-versioner

### Files to Keep (No Changes)

| File | Purpose |
|------|---------|
| `src/changelog/commitParser.ts` | Extracts changelog entries from git commits |
| `src/utils/jsonOutput.ts` | JSON output mechanism for CI/CD |

### Types to Keep

Move these interfaces from `src/changelog/changelogManager.ts` to `src/types.ts`:

```typescript
interface ChangelogEntry {
  type: 'added' | 'changed' | 'deprecated' | 'removed' | 'fixed' | 'security';
  description: string;
  issueIds?: string[];
  scope?: string;
  originalType?: string;
}
```

The `PackageChangelogData` interface in `src/utils/jsonOutput.ts` stays as-is.

## What to Remove

### Files to Delete

```
src/changelog/formatters.ts           # Keep-a-Changelog/Angular formatting logic
src/changelog/templates.ts            # Default template strings
src/changelog/changelogRegenerator.ts # Regeneration command logic
test/integration/changelogs.spec.ts   # Changelog integration tests
test/unit/changelog/formatters.spec.ts
test/unit/changelog/changelogRegenerator.spec.ts
test/unit/changelog/changelogManager.spec.ts
test/unit/changelog/templates.spec.ts
test/fixtures/changelog-test/         # Entire directory
docs/changelogs.md                    # Changelog documentation
```

### Files to Modify

#### `src/changelog/changelogManager.ts`

**Action: DELETE entire file**

Move interface definitions to `src/types.ts`:
- `ChangelogEntry`
- `ChangelogVersion` (optional, may not be needed)
- `Changelog` (optional, may not be needed)

#### `src/types.ts`

Changes:
1. Add `ChangelogEntry` interface (moved from changelogManager.ts)
2. Remove `writeChangelog` from `Config` interface
3. Remove `changelogFormat` from `Config` interface

```typescript
// Before
interface Config {
  // ...
  writeChangelog?: boolean;
  changelogFormat?: 'keep-a-changelog' | 'angular';
}

// After
interface Config {
  // ... (options removed)
}
```

#### `src/index.ts`

Changes:
1. Remove import: `import { regenerateChangelog, writeChangelog } from './changelog/changelogRegenerator.js'`
2. Remove entire `changelog` command (lines 182-239)

#### `src/core/versionStrategies.ts`

Changes:
1. Remove import: `import { type ChangelogEntry, updateChangelog } from '../changelog/changelogManager.js'`
2. Keep import: `import { extractChangelogEntriesFromCommits } from '../changelog/commitParser.js'`
3. Keep import: `import { addChangelogData } from '../utils/jsonOutput.js'`
4. In `createSingleStrategy()`:
   - Keep: `changelogEntries` extraction logic (lines 344-394)
   - Keep: `addChangelogData()` call (lines 422-430)
   - Remove: `updateChangelog()` call and related logic (lines 432-442)

```typescript
// REMOVE this block:
if (config.writeChangelog !== false) {
  updateChangelog(
    pkgPath,
    packageName,
    nextVersion,
    changelogEntries,
    repoUrl,
    config.changelogFormat,
  );
}
```

#### `src/package/packageProcessor.ts`

Changes:
1. Remove import: `import { type ChangelogEntry, updateChangelog } from '../changelog/changelogManager.js'`
2. Keep import: `import { extractChangelogEntriesFromCommits } from '../changelog/commitParser.js'`
3. In `processPackages()`:
   - Keep: `changelogEntries` extraction logic
   - Keep: `addChangelogData()` call (line 256)
   - Remove: `updateChangelog()` call (lines 266-275)

```typescript
// REMOVE this block:
if (this.fullConfig.writeChangelog !== false) {
  updateChangelog(
    pkgPath,
    name,
    nextVersion,
    changelogEntries,
    repoUrl,
    this.fullConfig.changelogFormat,
  );
}
```

#### `README.md`

Changes:
1. Remove "Automatically generates and maintains changelogs" from features
2. Remove "Changelog Generation" section references
3. Add note pointing to `changelog-creator` tool
4. Remove `writeChangelog` and `changelogFormat` from configuration table

#### `docs/versioning.md`

Changes:
1. No changes needed (versioning logic unchanged)

## JSON Output Contract (Unchanged)

The `--json` flag output remains the same:

```typescript
interface JsonOutputData {
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

interface PackageChangelogData {
  packageName: string;
  version: string;
  previousVersion: string | null;
  revisionRange: string;
  repoUrl: string | null;
  entries: ChangelogEntry[];
}
```

## Usage After Changes

```bash
# Version bump + output JSON
npx package-versioner --bump minor --json > version-data.json

# Generate changelog with separate tool
npx changelog-creator --input version-data.json

# Or pipe directly
npx package-versioner --json | npx changelog-creator
```

## Directory Structure After Changes

```
package-versioner/
├── src/
│   ├── changelog/
│   │   └── commitParser.ts        # Only remaining file
│   ├── core/
│   │   ├── versionCalculator.ts
│   │   ├── versionEngine.ts
│   │   └── versionStrategies.ts
│   ├── errors/
│   ├── git/
│   ├── package/
│   ├── utils/
│   │   ├── jsonOutput.ts          # Keeps addChangelogData()
│   │   └── ...
│   ├── config.ts
│   ├── index.ts                   # No changelog command
│   └── types.ts                   # ChangelogEntry moved here
├── test/
│   ├── integration/
│   │   └── versioning.spec.ts     # changelogs.spec.ts removed
│   └── unit/
│       └── changelog/             # Remove directory
├── docs/
│   └── versioning.md              # changelogs.md removed
└── README.md
```

## Implementation Steps

### Step 1: Move Types
- [ ] Add `ChangelogEntry` interface to `src/types.ts`
- [ ] Update imports in `commitParser.ts` and `jsonOutput.ts`

### Step 2: Remove Changelog Writing
- [ ] Remove `updateChangelog()` calls from `versionStrategies.ts`
- [ ] Remove `updateChangelog()` calls from `packageProcessor.ts`
- [ ] Remove imports for removed functions

### Step 3: Delete Files
- [ ] Delete `src/changelog/changelogManager.ts`
- [ ] Delete `src/changelog/formatters.ts`
- [ ] Delete `src/changelog/templates.ts`
- [ ] Delete `src/changelog/changelogRegenerator.ts`
- [ ] Delete `test/integration/changelogs.spec.ts`
- [ ] Delete `test/unit/changelog/` directory
- [ ] Delete `test/fixtures/changelog-test/` directory
- [ ] Delete `docs/changelogs.md`

### Step 4: Update CLI
- [ ] Remove `changelog` command from `src/index.ts`
- [ ] Remove related imports

### Step 5: Update Config Options
- [ ] Remove `writeChangelog` option from types
- [ ] Remove `changelogFormat` option from types

### Step 6: Update Documentation
- [ ] Update README.md (remove changelog references)

### Step 7: Update Tests
- [ ] Remove changelog-related test utilities
- [ ] Ensure remaining tests pass

### Step 8: Version Bump
- [ ] Update CHANGELOG.md with changes
- [ ] Release new version

## Testing Checklist

- [ ] `pnpm build` succeeds
- [ ] `pnpm test` passes (excluding removed tests)
- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes
- [ ] JSON output still includes changelog data

## Post-Extraction

After this plan is complete, create the `changelog-creator` repository with:
- Multiple input sources (package-versioner JSON, git log, manual)
- Template engines (Liquid, EJS, Handlebars)
- LLM integration (OpenAI, Anthropic, Ollama)
- Monorepo support (root + per-package changelogs)
- Multiple output formats (markdown, GitHub releases)

See the changelog-creator architecture spec for details.
