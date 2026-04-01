# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).



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
