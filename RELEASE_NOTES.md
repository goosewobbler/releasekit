

## `@releasekit/notes` @ 0.18.0

### New:
- Implemented per-PR evaluation and notification for release gates.
- Enabled release notes editing directly within the standing PR.
- Added batch accumulation controls for the standing PR strategy.
- Added runStandingPRMerge functionality and updated related commands.
- Implemented commit status checks for standing PRs.
- Added standing PR configuration and workflow.
- Added standing PR functionality to the project.
- Added per-package push support in non-sync mode.

### Changed:
- **CI**: Added Claude Code integration to GitHub workflows.
- **Dependencies**: Updated liquidjs dependency from 10.25.5 to 10.25.7.
- **CI**: Updated CI setup documentation for the standing PR workflow.

**Full Changelog**: https://github.com/goosewobbler/releasekit/compare/releasekit-notes-v0.17.1...releasekit-notes-v0.18.0

---


## `@releasekit/publish` @ 0.18.0

### New:
- Implemented per-PR evaluation and notification for release gates.
- **CI**: Added Claude Code GitHub workflows for enhanced automation.
- Enabled editing of release notes directly within standing PRs.
- Added configuration options to control batch accumulation for standing PR strategy.
- Added command to run standing PR merge operations.
- Added commit status checks for standing PRs.
- Added configuration and workflow for standing PRs.
- Added support for per-package push in non-sync mode.

### Changed:
- **Dependencies**: Updated liquidjs dependency from version 10.25.5 to 10.25.7.

### Documentation:
- Updated CI setup documentation to include standing PR workflow instructions.

**Full Changelog**: https://github.com/goosewobbler/releasekit/compare/releasekit-notes-v0.17.1...releasekit-notes-v0.18.0

---


## `@releasekit/release` @ 0.18.0

### New:
- Release gates now evaluate and notify on a per-pull request basis.
- Release notes can now be edited directly in the standing pull request.
- Added controls for configuring batch accumulation when using the standing PR strategy.
- Added a new command for merging standing pull requests with automatic merging functionality.
- Standing pull requests now display commit status checks to track validation status.
- Added configuration and workflow support for creating and managing standing pull requests.
- Implemented support for pushing individual packages independently in non-sync mode.
- Added the ability to push packages one at a time instead of all at once when sync is disabled.

### Changed:
- **CI**: Added GitHub workflows for Claude Code integration.
- **Dependencies**: Updated the LiquidJS template library to version 10.25.7.

### Documentation:
- Updated documentation to reflect changes in the standing PR workflow setup.

**Full Changelog**: https://github.com/goosewobbler/releasekit/compare/releasekit-notes-v0.17.1...releasekit-notes-v0.18.0

---


## `@releasekit/version` @ 0.18.0

### New:
- Added per-PR evaluation and notification for release gates.
- Added ability to edit release notes directly in standing PRs.
- Added configurable batch accumulation controls for standing PR strategy.
- Added command to run standing PR merges.
- Added commit status checks for standing PRs.
- Added configuration and workflow for standing PRs.
- Added standing PR functionality.
- Added per-package push support in non-sync mode.

### Documentation:
- Updated CI setup documentation for standing PR workflow.

### Developer:
- **CI**: Added GitHub workflows for Claude Code integration.
- **Dependencies**: Updated liquidjs dependency to version 10.25.7.

**Full Changelog**: https://github.com/goosewobbler/releasekit/compare/releasekit-notes-v0.17.1...releasekit-notes-v0.18.0

