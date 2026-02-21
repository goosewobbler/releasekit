import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeCliCommand } from '../utils/cli.js';
import { createConventionalCommit, initGitRepo, safeGitCommit } from '../utils/git.js';
import { createPackageJson, createVersionConfig, readChangelog } from '../utils/package.js';
import { cleanupTempDir, copyFixtureToTemp, symlinkNodeModules } from '../utils/tempFixture.js';

let tempDir: string;
let angularTempDir: string;
let regenTempDir: string;

// Add debug logging to helpers and after CLI runs
function debugLog(label: string, value: unknown) {
  console.log(`[DEBUG] ${label}:`, value);
}

// Patch executeCliCommand to log output and errors
function executeCliCommandWithDebug(command: string, cwd: string, dryRun = false) {
  debugLog('CLI Command', command);
  debugLog('CLI CWD', cwd);
  try {
    const result = executeCliCommand(command, cwd, dryRun);
    if (typeof result === 'object' && result !== null) {
      if ('stdout' in result) debugLog('CLI STDOUT', result.stdout);
      if ('stderr' in result) debugLog('CLI STDERR', result.stderr);
      if ('status' in result) debugLog('CLI STATUS', result.status);
    } else {
      debugLog('CLI RESULT', result);
    }
    return result;
  } catch (err) {
    debugLog('CLI ERROR', err);
    throw err;
  }
}

// Patch createConventionalCommit to log cwd and errors
function createConventionalCommitWithDebug(...args: Parameters<typeof createConventionalCommit>) {
  debugLog('createConventionalCommit args', args);
  try {
    return createConventionalCommit(...args);
  } catch (err) {
    debugLog('createConventionalCommit ERROR', err);
    throw err;
  }
}

function logGitLog(cwd: string) {
  try {
    const log = execSync('git log --oneline', { cwd }).toString();
    debugLog('git log', log);
    if (!log.trim()) throw new Error('No commits found in temp repo after creating commits');
  } catch (err) {
    debugLog('git log ERROR', err);
  }
}

function logLs(cwd: string) {
  try {
    const ls = execSync('ls -la', { cwd }).toString();
    debugLog('ls -la', ls);
  } catch (err) {
    debugLog('ls -la ERROR', err);
  }
}

function logConfig(cwd: string) {
  try {
    const config = fs.readFileSync(join(cwd, 'version.config.json'), 'utf8');
    debugLog('version.config.json', config);
  } catch (err) {
    debugLog('version.config.json ERROR', err);
  }
}

describe('Changelog Integration Tests', () => {
  beforeEach(() => {
    // Copy the changelog fixture to a new temp directory for each test
    tempDir = copyFixtureToTemp('test/fixtures/changelog-test/keep-a-changelog');
    symlinkNodeModules(tempDir);
    // Set up git, package.json, etc. as needed
    initGitRepo(tempDir);
    createPackageJson(tempDir, 'keep-a-changelog-test');
    createVersionConfig(tempDir, {
      preset: 'conventional-commits',
      packages: ['.'],
      versionPrefix: 'v',
      writeChangelog: true,
      changelogFormat: 'keep-a-changelog',
    });
    execSync('git add .', { cwd: tempDir });
    safeGitCommit(tempDir, 'chore: setup project');
  });

  afterEach(() => {
    // Clean up the temp directory after each test
    cleanupTempDir(tempDir);
  });

  describe('Keep a Changelog Format', () => {
    it('should generate a changelog file with Keep a Changelog format', () => {
      createConventionalCommitWithDebug(tempDir, 'feat', 'add new feature');
      createConventionalCommitWithDebug(tempDir, 'fix', 'fix a bug', 'core');
      createConventionalCommitWithDebug(tempDir, 'docs', 'improve documentation');
      executeCliCommandWithDebug('version --bump minor', tempDir, false);
      const changelog = readChangelog(tempDir);
      if (!changelog) {
        debugLog('CHANGELOG.md', 'missing or empty');
      } else {
        debugLog('CHANGELOG.md', changelog);
      }
      expect(changelog).toContain('# Changelog');
      expect(changelog).toContain('The format is based on [Keep a Changelog]');
      expect(changelog).toContain('## [0.2.0]');
      expect(changelog).toContain('### Added');
      expect(changelog).toContain('### Fixed');
      expect(changelog).toContain('### Changed');
      expect(changelog).toContain('- add new feature');
      expect(changelog).toContain('- **core**: fix a bug');
      expect(changelog).toContain('- improve documentation');
      logGitLog(tempDir);
      logConfig(tempDir);
      logLs(tempDir);
    });

    it('should update an existing Keep a Changelog format changelog', () => {
      // First generate a changelog
      createConventionalCommitWithDebug(tempDir, 'feat', 'add first feature');
      executeCliCommandWithDebug('version --bump minor', tempDir, false);

      // Now add more commits and generate a new version
      createConventionalCommitWithDebug(tempDir, 'fix', 'fix a critical bug');
      executeCliCommandWithDebug('version --bump patch', tempDir, false);

      // Verify the changelog was updated
      const changelog = readChangelog(tempDir);

      // Check for both versions
      expect(changelog).toContain('## [0.2.1]');
      expect(changelog).toContain('## [0.2.0]');

      // Check content
      expect(changelog).toContain('- fix a critical bug');
      expect(changelog).toContain('- add first feature');
      logGitLog(tempDir);
      logConfig(tempDir);
      logLs(tempDir);
    });

    it('should properly handle breaking changes', () => {
      // Create a breaking change commit
      createConventionalCommitWithDebug(tempDir, 'feat', 'add breaking feature', 'api', true);

      // Execute the version bump command
      executeCliCommandWithDebug('version --bump major', tempDir, false);

      // Verify the changelog was created and has the correct format
      const changelog = readChangelog(tempDir);

      // Check content - breaking changes should be marked
      expect(changelog).toContain('## [1.0.0]');
      expect(changelog).toContain('### Added');
      expect(changelog).toContain('- **BREAKING** **api**: add breaking feature');
      logGitLog(tempDir);
      logConfig(tempDir);
      logLs(tempDir);
    });
  });

  describe('Angular Changelog Format', () => {
    beforeEach(() => {
      angularTempDir = copyFixtureToTemp('test/fixtures/changelog-test/angular-changelog');
      symlinkNodeModules(angularTempDir);
      initGitRepo(angularTempDir);
      createPackageJson(angularTempDir, 'angular-changelog-test');
      createVersionConfig(angularTempDir, {
        preset: 'conventional-commits',
        packages: ['.'],
        versionPrefix: 'v',
        writeChangelog: true,
        changelogFormat: 'angular',
      });
      execSync('git add .', { cwd: angularTempDir });
      safeGitCommit(angularTempDir, 'chore: setup project');
    });

    afterEach(() => {
      cleanupTempDir(angularTempDir);
    });

    it('should generate a changelog file with Angular format', () => {
      // Create different types of commits for changelog generation
      createConventionalCommitWithDebug(angularTempDir, 'feat', 'add new feature', 'ui');
      createConventionalCommitWithDebug(angularTempDir, 'fix', 'fix a critical bug', 'core');
      createConventionalCommitWithDebug(angularTempDir, 'perf', 'improve performance', 'api');

      // Execute the version bump command
      executeCliCommandWithDebug('version --bump minor', angularTempDir, false);

      // Verify the changelog was created and has the correct format
      const changelog = readChangelog(angularTempDir);

      // Check for Angular structure
      expect(changelog).toContain('# Changelog');

      // Check for appropriate sections (Angular-style)
      expect(changelog).toContain('## [0.2.0]');
      expect(changelog).toContain('### Features');
      expect(changelog).toContain('### Bug Fixes');
      expect(changelog).toContain('### Performance Improvements');

      // Check content grouped by scope
      expect(changelog).toContain('* **ui:**');
      expect(changelog).toContain('* **core:**');
      expect(changelog).toContain('* **api:**');

      // Check specific entries
      expect(changelog).toMatch(/\* \*\*ui:\*\*[\s\S]*add new feature/);
      expect(changelog).toMatch(/\* \*\*core:\*\*[\s\S]*fix a critical bug/);
      expect(changelog).toMatch(/\* \*\*api:\*\*[\s\S]*improve performance/);
      logGitLog(angularTempDir);
      logConfig(angularTempDir);
      logLs(angularTempDir);
    });

    it('should update an existing Angular format changelog', () => {
      // First generate a changelog
      createConventionalCommitWithDebug(angularTempDir, 'feat', 'add first feature', 'ui');
      executeCliCommandWithDebug('version --bump minor', angularTempDir, false);

      // Now add more commits and generate a new version
      createConventionalCommitWithDebug(angularTempDir, 'fix', 'fix a critical bug', 'core');
      executeCliCommandWithDebug('version --bump patch', angularTempDir, false);

      // Verify the changelog was updated
      const changelog = readChangelog(angularTempDir);

      // Check for both versions
      expect(changelog).toContain('## [0.2.1]');
      expect(changelog).toContain('## [0.2.0]');

      // Check content in proper sections
      expect(changelog).toMatch(/## \[0.2.1\][\s\S]*Bug Fixes[\s\S]*\*\*core:\*\*[\s\S]*fix a critical bug/);
      expect(changelog).toMatch(/## \[0.2.0\][\s\S]*Features[\s\S]*\*\*ui:\*\*[\s\S]*add first feature/);
      logGitLog(angularTempDir);
      logConfig(angularTempDir);
      logLs(angularTempDir);
    });

    it('should add a dedicated breaking changes section for breaking changes', () => {
      // Create a breaking change commit
      createConventionalCommitWithDebug(angularTempDir, 'feat', 'add breaking feature', 'api', true);

      // Execute the version bump command
      executeCliCommandWithDebug('version --bump major', angularTempDir, false);

      // Verify the changelog has a BREAKING CHANGES section
      const changelog = readChangelog(angularTempDir);

      // Check content - features and breaking changes sections
      expect(changelog).toContain('## [1.0.0]');
      expect(changelog).toContain('### Features');
      expect(changelog).toContain('### BREAKING CHANGES');

      // The feature should appear in both sections
      expect(changelog).toMatch(/Features[\s\S]*\*\*api:\*\*[\s\S]*add breaking feature/);
      expect(changelog).toMatch(/BREAKING CHANGES[\s\S]*\*\*api:\*\*[\s\S]*add breaking feature/);
      logGitLog(angularTempDir);
      logConfig(angularTempDir);
      logLs(angularTempDir);
    });
  });

  describe('Changelog Regeneration Feature', () => {
    beforeEach(() => {
      regenTempDir = copyFixtureToTemp('test/fixtures/changelog-test/changelog-regeneration');
      symlinkNodeModules(regenTempDir);
      initGitRepo(regenTempDir);
      // Create package.json with repository field for URL detection
      const packageJson = {
        name: 'changelog-regeneration-test',
        version: '0.1.0',
        private: true,
        repository: {
          type: 'git',
          url: 'https://github.com/example/changelog-regeneration-test',
        },
      };
      fs.writeFileSync(join(regenTempDir, 'package.json'), JSON.stringify(packageJson, null, 2));

      // Create version.config.json with keep-a-changelog format
      createVersionConfig(regenTempDir, {
        preset: 'conventional-commits',
        packages: ['.'],
        versionPrefix: 'v',
        writeChangelog: true,
        changelogFormat: 'keep-a-changelog',
      });

      // Add files to git
      fs.writeFileSync(join(regenTempDir, 'README.md'), '# Dummy file');
      execSync('git add .', { cwd: regenTempDir });
      safeGitCommit(regenTempDir, 'Initial commit');
    });

    afterEach(() => {
      cleanupTempDir(regenTempDir);
    });

    it('should regenerate a changelog from git history with multiple versions', () => {
      // Create a history with multiple releases
      // First version 0.1.0
      createConventionalCommitWithDebug(regenTempDir, 'feat', 'add initial feature');
      createConventionalCommitWithDebug(regenTempDir, 'fix', 'fix initial bug', 'core');
      try {
        execSync('git tag -d v0.1.0', { cwd: regenTempDir });
      } catch {
        // Tag doesn't exist, ignore
      }
      execSync('git tag v0.1.0', { cwd: regenTempDir });

      // Second version 0.2.0
      createConventionalCommitWithDebug(regenTempDir, 'feat', 'add second feature', 'ui');
      createConventionalCommitWithDebug(regenTempDir, 'docs', 'improve documentation');
      try {
        execSync('git tag -d v0.2.0', { cwd: regenTempDir });
      } catch {
        // Tag doesn't exist, ignore
      }
      execSync('git tag v0.2.0', { cwd: regenTempDir });

      // Third version 1.0.0 with breaking change
      createConventionalCommitWithDebug(regenTempDir, 'feat', 'add breaking feature', 'api', true);
      createConventionalCommitWithDebug(regenTempDir, 'fix', 'fix critical issue', 'security');
      try {
        execSync('git tag -d v1.0.0', { cwd: regenTempDir });
      } catch {
        // Tag doesn't exist, ignore
      }
      execSync('git tag v1.0.0', { cwd: regenTempDir });

      // Run the CLI regeneration command
      executeCliCommandWithDebug(
        'changelog --regenerate --format keep-a-changelog --output CHANGELOG.md',
        regenTempDir,
      );

      // Verify the changelog has the correct format
      const changelog = readChangelog(regenTempDir);

      // Check for basic structure
      expect(changelog).toContain('# Changelog');
      expect(changelog).toContain('The format is based on [Keep a Changelog]');

      // Check for all three versions
      expect(changelog).toContain('## [1.0.0]');
      expect(changelog).toContain('## [0.2.0]');
      expect(changelog).toContain('## [0.1.0]');

      // Check content of version 0.1.0
      expect(changelog).toMatch(/## \[0.1.0\][\s\S]*### Added[\s\S]*- add initial feature/);
      expect(changelog).toMatch(/## \[0.1.0\][\s\S]*### Fixed[\s\S]*- \*\*core\*\*: fix initial bug/);

      // Check content of version 0.2.0
      expect(changelog).toMatch(/## \[0.2.0\][\s\S]*### Added[\s\S]*- \*\*ui\*\*: add second feature/);
      expect(changelog).toMatch(/## \[0.2.0\][\s\S]*### Changed[\s\S]*- improve documentation/);

      // Check content of version 1.0.0 with breaking changes
      expect(changelog).toMatch(
        /## \[1.0.0\][\s\S]*### Added[\s\S]*- \*\*BREAKING\*\* \*\*api\*\*: add breaking feature/,
      );
      expect(changelog).toMatch(/## \[1.0.0\][\s\S]*### Fixed[\s\S]*- \*\*security\*\*: fix critical issue/);

      // Check for links
      expect(changelog).toContain('[1.0.0]: https://github.com/example/changelog-regeneration-test/');
      expect(changelog).toContain('[0.2.0]: https://github.com/example/changelog-regeneration-test/');
      expect(changelog).toContain('[0.1.0]: https://github.com/example/changelog-regeneration-test/');
      logGitLog(regenTempDir);
      logConfig(regenTempDir);
      logLs(regenTempDir);
    });

    it('should regenerate a changelog with Angular format', () => {
      // Create a history with multiple releases
      // First version 0.1.0
      createConventionalCommitWithDebug(regenTempDir, 'feat', 'add initial feature', 'core');
      createConventionalCommitWithDebug(regenTempDir, 'fix', 'fix initial bug', 'ui');
      try {
        execSync('git tag -d v0.1.0', { cwd: regenTempDir });
      } catch {
        // Tag doesn't exist, ignore
      }
      execSync('git tag v0.1.0', { cwd: regenTempDir });

      // Second version 0.2.0
      createConventionalCommitWithDebug(regenTempDir, 'feat', 'add second feature', 'api');
      createConventionalCommitWithDebug(regenTempDir, 'perf', 'improve performance', 'core');
      try {
        execSync('git tag -d v0.2.0', { cwd: regenTempDir });
      } catch {
        // Tag doesn't exist, ignore
      }
      execSync('git tag v0.2.0', { cwd: regenTempDir });

      // Update config to use Angular format
      createVersionConfig(regenTempDir, {
        preset: 'conventional-commits',
        packages: ['.'],
        versionPrefix: 'v',
        writeChangelog: true,
        changelogFormat: 'angular',
      });

      // Run the CLI regeneration command
      executeCliCommandWithDebug('changelog --regenerate --format angular --output CHANGELOG.md', regenTempDir);

      // Verify the changelog was created with Angular format
      const changelog = readChangelog(regenTempDir);

      // Check for Angular structure
      expect(changelog).toContain('# Changelog');

      // Check for version sections
      expect(changelog).toContain('## [0.2.0]');
      expect(changelog).toContain('## [0.1.0]');

      // Check for Angular-style sections
      expect(changelog).toContain('### Features');
      expect(changelog).toContain('### Bug Fixes');
      expect(changelog).toContain('### Performance Improvements');

      // Check content of version 0.1.0
      expect(changelog).toMatch(/## \[0.1.0\][\s\S]*Features[\s\S]*\*\*core:\*\*[\s\S]*add initial feature/);
      expect(changelog).toMatch(/## \[0.1.0\][\s\S]*Bug Fixes[\s\S]*\*\*ui:\*\*[\s\S]*fix initial bug/);

      // Check content of version 0.2.0
      expect(changelog).toMatch(/## \[0.2.0\][\s\S]*Features[\s\S]*\*\*api:\*\*[\s\S]*add second feature/);
      expect(changelog).toMatch(
        /## \[0.2.0\][\s\S]*Performance Improvements[\s\S]*\*\*core:\*\*[\s\S]*improve performance/,
      );
      logGitLog(regenTempDir);
      logConfig(regenTempDir);
      logLs(regenTempDir);
    });

    it('should respect the --since flag to limit history', () => {
      // Create a history with multiple releases
      // First version 0.1.0
      createConventionalCommitWithDebug(regenTempDir, 'feat', 'add initial feature');
      createConventionalCommitWithDebug(regenTempDir, 'fix', 'fix initial bug');
      try {
        execSync('git tag -d v0.1.0', { cwd: regenTempDir });
      } catch {
        // Tag doesn't exist, ignore
      }
      execSync('git tag v0.1.0', { cwd: regenTempDir });

      // Second version 0.2.0
      createConventionalCommitWithDebug(regenTempDir, 'feat', 'add second feature');
      createConventionalCommitWithDebug(regenTempDir, 'docs', 'improve documentation');
      try {
        execSync('git tag -d v0.2.0', { cwd: regenTempDir });
      } catch {
        // Tag doesn't exist, ignore
      }
      execSync('git tag v0.2.0', { cwd: regenTempDir });

      // Third version 1.0.0
      createConventionalCommitWithDebug(regenTempDir, 'feat', 'add third feature');
      try {
        execSync('git tag -d v1.0.0', { cwd: regenTempDir });
      } catch {
        // Tag doesn't exist, ignore
      }
      execSync('git tag v1.0.0', { cwd: regenTempDir });

      // Run the CLI regeneration command with --since v0.2.0
      executeCliCommandWithDebug(
        'changelog --regenerate --format keep-a-changelog --output CHANGELOG.md --since v0.2.0',
        regenTempDir,
      );

      // Verify the changelog only includes versions from the specified commit onwards
      const changelog = readChangelog(regenTempDir);

      // Should include v0.2.0 and v1.0.0 but not v0.1.0
      expect(changelog).toContain('## [1.0.0]');
      expect(changelog).toContain('## [0.2.0]');
      expect(changelog).not.toContain('## [0.1.0]');

      // Check for the correct content
      expect(changelog).toMatch(/## \[1.0.0\][\s\S]*### Added[\s\S]*- add third feature/);
      expect(changelog).toMatch(/## \[0.2.0\][\s\S]*### Added[\s\S]*- add second feature/);
      expect(changelog).not.toMatch(/fix initial bug/);
      logGitLog(regenTempDir);
      logConfig(regenTempDir);
      logLs(regenTempDir);
    });

    it('should work in dry run mode without writing to file', () => {
      // Create a simple git history
      createConventionalCommitWithDebug(regenTempDir, 'feat', 'add initial feature');
      createConventionalCommitWithDebug(regenTempDir, 'fix', 'fix initial bug', 'core');
      try {
        execSync('git tag -d v0.1.0', { cwd: regenTempDir });
      } catch {
        // Tag doesn't exist, ignore
      }
      execSync('git tag v0.1.0', { cwd: regenTempDir });

      // Second version 0.2.0
      createConventionalCommitWithDebug(regenTempDir, 'feat', 'add second feature', 'ui');
      createConventionalCommitWithDebug(regenTempDir, 'fix', 'fix second bug');
      try {
        execSync('git tag -d v0.2.0', { cwd: regenTempDir });
      } catch {
        // Tag doesn't exist, ignore
      }
      execSync('git tag v0.2.0', { cwd: regenTempDir });

      // Run the CLI regeneration command in dry run mode
      executeCliCommandWithDebug(
        'changelog --regenerate --format keep-a-changelog --output CHANGELOG.md --dry-run',
        regenTempDir,
      );

      // Verify no changelog file was created
      expect(existsSync(join(regenTempDir, 'CHANGELOG.md'))).toBe(false);
      logGitLog(regenTempDir);
      logConfig(regenTempDir);
      logLs(regenTempDir);
    });
  });
});
