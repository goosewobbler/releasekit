

## `monorepo` @ 0.25.0

### New:
- Release PRs can now be retried by commenting with the release:retry label. (#245)
- Release PRs now display a report when only some packages fail to publish. (#243)
- Publish operations now automatically retry on transient registry errors. (#244)

### Fixed:
- **Tooling**: Fixed lint-staged to handle unprocessable file paths and process .jsonc files. (#251)
- Fixed config discovery to properly parse and load .jsonc configuration files. (#247)
- Added --reconcile flag to bypass skip-pattern guards for standing PRs. (#246)

### Documentation:
- Added CLI reference documentation. (#256)
- Documented .jsonc configuration file support in README.

**Full Changelog**: https://github.com/goosewobbler/releasekit/compare/0.24.0...0.25.0

