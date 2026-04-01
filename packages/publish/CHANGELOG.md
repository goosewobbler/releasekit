# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).













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
