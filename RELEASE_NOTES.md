

## `@releasekit/version` @ 0.5.0

### New:
- Added a titleTemplate config option and moved sanitizePackageName to the core module.

### Fixed:
- Fixed tagTemplate to use the configured prefix placeholder instead of a hardcoded 'v'.
- Fixed version extraction to correctly strip the sanitized dash-format package prefix from tags.
- Fixed publishing to resolve the title from releaseNotes keys when no changelogs are present.
- Fixed changelog data and tag matching for per-package sync releases.

### Developer:
- **Code Quality**: Removed duplicate escapeRegExp implementation by using the shared utility in the version module.
- **Testing**: Generalized the dash-format tag strip regression test to cover more cases.
- **Code Quality**: Simplified the formatChangelogForTag function by replacing a nested ternary with clearer logic.

---


## `@releasekit/notes` @ 0.5.0

### New:
- Extracted sanitizePackageName to the core and added a new titleTemplate configuration option.

### Fixed:
- Fixed configuration to use a variable prefix in tag templates instead of the hardcoded 'v'.
- Fixed version extraction to strip the sanitized dash-format package prefix from tags.
- Fixed publishing to resolve title from releaseNotes keys when no changelogs are present.
- Fixed changelog data and tag matching for per-package sync releases.

### Changed:
- Updated version component to use the shared escapeRegExp utility, removing duplicated code.
- Simplified formatChangelogForTag by replacing nested ternary with clearer logic.

### Developer:
- **Testing**: Generalized the regression test for dash-format tag stripping to cover additional cases.

---


## `@releasekit/publish` @ 0.5.0

### New:
- Extracted sanitizePackageName into the core module and added a configurable titleTemplate option.

### Fixed:
- Fixed the tag template to use the configurable prefix placeholder instead of a hardcoded 'v'.
- Stripped the sanitized dash-format package prefix when extracting the version from a tag.
- Resolved the release title from the releaseNotes keys when no changelogs are present.
- Corrected changelog data and tag matching for per-package synchronized releases.

### Changed:
- Used the shared escapeRegExp utility from formatting utils instead of duplicating it locally.
- Replaced the nested ternary operator in formatChangelogForTag with clearer logic.

### Developer:
- **Testing**: Generalized the regression test for dash-format tag stripping.

---


## `@releasekit/release` @ 0.5.0

### New:
- **Code Quality**: Added a new titleTemplate config option and moved sanitizePackageName to the core module.

### Fixed:
- Fixed the tag template to use the configurable prefix instead of a hardcoded 'v'.
- Fixed version extraction to strip the sanitized dash-format package prefix from tags.
- Fixed release title resolution to fall back to the releaseNotes keys when changelogs are empty.
- Fixed changelog data and tag matching for per-package synchronized releases.

### Changed:
- **Code Quality**: Replaced the local duplicate escapeRegExp function with the version from the formatting utilities.
- **Testing**: Generalized the dash-format tag stripping regression test to cover more cases.
- **Code Quality**: Replaced a nested ternary expression in formatChangelogForTag with clearer logic.

