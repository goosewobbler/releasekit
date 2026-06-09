

## `monorepo` @ 0.26.0

### New:
- Introduced fixed and linked sync semantics for version groups. (#265)
- Added a new command to synchronize labels between the monorepo and GitHub. (#262)

### Fixed:
- Added `ci.scopeLabels` property to the JSON schema configuration. (#277)
- Fixed version divergence warnings to only appear when a fixed-group is actively releasing.
- Fixed breaking changes before v1.0 to remain on the 0.x minor version instead of bumping the major. (#274)

### Changed:
- **Dependencies**: Updated the Claude Code action from v1.0.135 to v1.0.140.
- **Dependencies**: Bumped 4 production dependencies to their latest versions.
- **CI**: Fixed pnpm setup in CI templates and added documentation for label creation. (#263)
- **Dependencies**: Dropped support for Node 20 (EOL) and now requires Node 22 or higher. (#264)
- **CI**: Added validated CI usage examples to the documentation. (#259)

**Full Changelog**: https://github.com/goosewobbler/releasekit/compare/0.25.0...0.26.0

