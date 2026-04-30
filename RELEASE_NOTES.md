

## `@releasekit/version` @ 0.19.0

### New:
- Added support for targeting all packages in the release workflow.
- Added option to skip specific packages from GitHub releases.

### Fixed:
- Corrected version calculation for manual releases when targeting specific package scopes.
- Fixed publishing pure Rust packages without a package.json file.

### Changed:
- **Dependencies**: Updated TypeScript ESLint parser dependency to the latest version.

**Full Changelog**: https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.18.0...releasekit-version-v0.19.0

---


## `@releasekit/notes` @ 0.19.0

### New:
- Added support for targeting all packages in the release workflow.
- Introduced a new option `githubRelease.skipPackages` to suppress GitHub releases.

### Fixed:
- Fixed a bug where manual release version calculation incorrectly handled scope-based package targeting.
- Fixed an issue that prevented publishing pure Rust projects without a `package.json`.

### Developer:
- **Dependencies**: Updated the @typescript-eslint/parser development dependency from version 8.58.2 to 8.59.0.

**Full Changelog**: https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.18.0...releasekit-version-v0.19.0

---


## `@releasekit/publish` @ 0.19.0

### New:
- Added support for targeting all packages in the release workflow.
- Added the githubRelease.skipPackages option to suppress GitHub releases.

### Fixed:
- Corrected the manual release version calculation when targeting packages by scope.
- Fixed pure Rust publishing when no package.json is present.

### Changed:
- Updated the @typescript-eslint/parser dev dependency from version 8.58.2 to 8.59.0.

**Full Changelog**: https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.18.0...releasekit-version-v0.19.0

---


## `@releasekit/release` @ 0.19.0

### New:
- Added support for targeting all packages in the release workflow.
- Added a githubRelease.skipPackages option to suppress GitHub releases.

### Fixed:
- Fixed an issue where manual release version calculations were incorrect when targeting packages by scope.
- Fixed a bug where pure Rust publishing required a package.json file.

### Developer:
- **Dependencies**: Updated the TypeScript ESLint parser development dependency from version 8.58.2 to 8.59.0.

**Full Changelog**: https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.18.0...releasekit-version-v0.19.0

