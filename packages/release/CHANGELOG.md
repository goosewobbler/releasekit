# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).















































## [0.7.42] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-release-v0.7.41...releasekit-release-v0.7.42)

### Fixed
- run CLI with node directly instead of pnpm exec

## [0.7.41] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-release-v0.7.40...releasekit-release-v0.7.41)

### Fixed
- scan pnpm subdirs for node_modules resolution

## [0.7.40] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-release-v0.7.39...releasekit-release-v0.7.40)

### Fixed
- resolve projectDir relative to cwd not action dir

## [0.7.39] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-release-v0.7.38...releasekit-release-v0.7.39)

### Fixed
- prioritize user project node_modules in NODE_PATH

## [0.7.38] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-release-v0.7.37...releasekit-release-v0.7.38)

### Fixed
- use pnpm exec and clean INPUT_* env vars for proper resolution

## [0.7.37] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-release-v0.7.36...releasekit-release-v0.7.37)

### Fixed
- remove INPUT_PROJECT_DIR from spawned env to fix path resolution

## [0.7.36] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-release-v0.7.35...releasekit-release-v0.7.36)

### Fixed
- properly traverse .pnpm dirs to find packages

## [0.7.35] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-release-v0.7.34...releasekit-release-v0.7.35)

### Fixed
- scan all directories in node_modules for better resolution

## [0.7.34] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-release-v0.7.33...releasekit-release-v0.7.34)

### Fixed
- filter non-directories from .pnpm scan

## [0.7.33] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-release-v0.7.32...releasekit-release-v0.7.33)

### Fixed
- scan .pnpm subdirs in NODE_PATH for module resolution

## [0.7.32] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.31...releasekit-version-v0.7.32)

### Changed
- add verbose logging option to run-action script and update action.yml to pass verbose input

## [0.7.31] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.30...releasekit-version-v0.7.31)

### Changed
- simplify action runtime dependency installation in action.yml and update script to use pnpm directly

## [0.7.30] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.29...releasekit-version-v0.7.30)

### Changed
- update action.yml to include build step after installing action runtime dependencies

## [0.7.29] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.28...releasekit-version-v0.7.29)

### Changed
- update action.yml to specify working-directory for installing action runtime dependencies

## [0.7.28] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.27...releasekit-version-v0.7.28)

### Changed
- set NODE_PATH in environment variables for action execution

## [0.7.27] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.26...releasekit-version-v0.7.27)

### Changed
- add npm-token input to action.yml for optional NPM token usage

## [0.7.26] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.25...releasekit-version-v0.7.26)

### Changed
- update action.yml to use dynamic working-directory and set environment variables for GITHUB_TOKEN and NPM_TOKEN

## [0.7.25] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.24...releasekit-version-v0.7.25)

### Changed
- remove working-directory specification for pnpm install in action.yml

## [0.7.24] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.23...releasekit-version-v0.7.24)

### Changed
- remove pnpm version specification in action.yml for simplified setup

## [0.7.23] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.22...releasekit-version-v0.7.23)

### Changed
- downgrade pnpm/action-setup from v6 to v5 in action.yml

## [0.7.22] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.21...releasekit-version-v0.7.22)

### Changed
- add node-version input and setup steps for pnpm and Node.js in action.yml
- **release**: remove '@octokit/rest' and clean up external dependencies in tsup.config.ts

## [0.7.21] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.20...releasekit-version-v0.7.21)

### Changed
- **release**: add '@octokit/rest' to external dependencies in tsup.config.ts for enhanced functionality

## [0.7.20] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.19...releasekit-version-v0.7.20)

### Changed
- **release**: add 'commander' to external dependencies in tsup.config.ts for enhanced functionality

## [0.7.19] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.18...releasekit-version-v0.7.19)

### Changed
- **release**: add 'zod' to external dependencies in tsup.config.ts for enhanced functionality

## [0.7.18] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.17...releasekit-version-v0.7.18)

### Changed
- **release**: add 'smol-toml' to external dependencies in tsup.config.ts for enhanced functionality

## [0.7.17] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.16...releasekit-version-v0.7.17)

### Changed
- **release**: add 'chalk' to external dependencies in tsup.config.ts for enhanced functionality

## [0.7.16] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.15...releasekit-version-v0.7.16)

### Changed
- **release**: remove 'commander' from external dependencies in tsup.config.ts for cleaner bundling

## [0.7.15] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.14...releasekit-version-v0.7.15)

### Changed
- **release**: refactor banner in tsup.config.ts to use alias for createRequire for improved ESM compatibility
- **release**: add banner to tsup.config.ts for module require support in ESM builds
- **release**: update tsup.config.ts to remove 'events' from external dependencies and add 'commander' to noExternal for improved bundling
- **release**: update tsup.config.ts to remove dts and minify options, adjust entry points, and expand noExternal list for improved bundling

## [0.7.14] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.13...releasekit-version-v0.7.14)

### Changed
- **release**: update tsup.config.ts to set platform to 'node', enable shims, and disable code splitting for improved bundling
- **release**: update tsup.config.ts to disable treeshaking and add 'commander' to noExternal for improved bundling

## [0.7.13] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.12...releasekit-version-v0.7.13)

### Changed
- **release**: change shims to bundle for improved output configuration

## [0.7.12] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.11...releasekit-version-v0.7.12)

### Added
- update action.yml name to include branding for automated versioning and release

### Changed
- move command factories to new modules with no isMain guard (#100)
- **version**: replace micromatch with minimatch in package filtering and matching utilities, update dependencies in package.json and pnpm-lock.yaml
- enable shims in tsup.config.ts for better compatibility with external modules
- update tsup.config.ts to set platform to 'node' for improved compatibility
- update tsup.config.ts to include additional noExternal packages for better bundling

## [0.7.11] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.10...releasekit-version-v0.7.11)

### Added
- add branding information to action.yml and enhance release workflow with GitHub token and conditional release creation

### Fixed
- remove yml from lint-staged to avoid biome hidden dir errors

## [0.7.10] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.9...releasekit-version-v0.7.10)

### Fixed
- skip git hooks in action dist commit

## [0.7.9] - 2026-04-02

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.8...releasekit-version-v0.7.9)

### Changed
- remove .github directory from includes in biome.jsonc while preserving existing exclusions
- update includes in biome.jsonc to prioritize .github directory while maintaining existing exclusions

## [0.7.8] - 2026-04-01

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.7...releasekit-version-v0.7.8)

### Changed
- simplify commit logic in release workflow by always committing dist files and conditionally updating major alias for stable releases
- refine lint-staged configuration in package.json to exclude yml files from formatting

## [0.7.7] - 2026-04-01

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.6...releasekit-version-v0.7.7)

### Changed
- consolidate array formatting in package.json files for consistency across projects
- add output for action tag in release workflow to capture generated release tag

## [0.7.6] - 2026-04-01

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.5...releasekit-version-v0.7.6)

### Changed
- swap build action dependencies in release workflow for better clarity and functionality
- update default value for sync option in release workflow to true

## [0.7.5] - 2026-04-01

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.4...releasekit-version-v0.7.5)

### Changed
- streamline package.json formatting by consolidating array elements for keywords and files

### Fixed
- update release workflow condition to trigger only on workflow_dispatch event

## [0.7.4] - 2026-04-01

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.3...releasekit-version-v0.7.4)

### Changed
- update release workflow to include write permissions for contents
- add reusable workflow for action release, including build, commit, and tagging logic

## [0.7.3] - 2026-04-01

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.2...releasekit-version-v0.7.3)

### Changed
- add git SSH configuration step for tag pushes in release workflow

### Fixed
- update execSync command in test-e2e.ts to use array syntax for improved readability

## [0.7.2] - 2026-04-01

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.1...releasekit-version-v0.7.2)

### Changed
- **deps**: bump the production-dependencies group across 1 directory with 7 updates (#79)
- update skipPatterns in releasekit.config.json to remove dependabot PR patterns
- **deps-dev**: bump the development-dependencies group across 1 directory with 5 updates (#38)

## [0.7.1] - 2026-04-01

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.7.0...releasekit-version-v0.7.1)

### Fixed
- update action-release workflow to use new tag format and improve version extraction logic (#99)

## [0.7.0] - 2026-04-01

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.6.1...releasekit-version-v0.7.0)

### Added
- introduce Github Action with release and preview modes (#97)
- **release**: add preview command to dispatcher (#96)
- **notes**: support OLLAMA_MODEL env var

## [0.6.1] - 2026-04-01

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.6.0...releasekit-version-v0.6.1)

### Fixed
- **notes**: suppress heading and add compare URL in per-package release notes (#95)
- **release**: pass PR label bump type through to the release workflow

## [0.6.0] - 2026-04-01

### Fixed
- **version**: count commits from repo root in sync mode (#94)
- **notes**: populate releaseNotes output and simplify GitHub release body fallback (#93)

## [0.5.0] - 2026-03-31

### Added
- **publish**: extract sanitizePackageName to core, add titleTemplate config

### Changed
- **version**: use escapeRegExp from formatting utils instead of local duplicate
- **test**: generalise dash-format tag strip regression test
- **publish**: replace nested ternary in formatChangelogForTag

### Fixed
- **config**: use \${prefix} in tagTemplate instead of hardcoded 'v'
- **version**: strip sanitized dash-format package prefix when extracting version from tag
- **publish**: resolve title from releaseNotes keys when changelogs is empty
- correct changelog data and tag matching for per-package sync releases
