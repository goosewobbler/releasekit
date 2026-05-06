

## `monorepo` @ 0.22.0

### New:
- Added baselineTagTemplate to specify tags that should survive force-moves.

### Fixed:
- Fixed version calculation to properly strip baselineTagTemplate prefix from baseline tags.
- Fixed release tags to be created locally before pushing, ensuring they exist if push fails.
- Fixed notes generation to gracefully truncate when LLM returns extra entries beyond the limit.

**Full Changelog**: https://github.com/goosewobbler/releasekit/compare/release/v0.21.0...0.22.0

