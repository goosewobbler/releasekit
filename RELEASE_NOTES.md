

## `@releasekit/version` @ 0.20.0

### New:
- Publish operations now behave idempotently, allowing safe retries.

### Fixed:
- **Security**: Fixed shell injection vulnerability in e2e test runner by using execFileSync instead of exec.

### Changed:
- Updated LLM provider interfaces and improved message handling for better reliability.

**Full Changelog**: https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.19.3...releasekit-version-v0.20.0

---


## `@releasekit/notes` @ 0.20.0

### New:
- Made publish operations idempotent, allowing safe retries without duplicate content.

### Fixed:
- **Security**: Switched to execFileSync in e2e test runner to prevent shell injection vulnerabilities.

### Changed:
- Updated LLM provider interfaces and improved message handling across the system.

**Full Changelog**: https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.19.3...releasekit-version-v0.20.0

---


## `@releasekit/publish` @ 0.20.0

### New:
- Added idempotent publish behavior to prevent duplicate publications

### Fixed:
- **Security**: Fixed shell injection vulnerability in e2e test runner by using execFileSync

### Changed:
- Updated LLM provider interfaces and improved message handling for better reliability

**Full Changelog**: https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.19.3...releasekit-version-v0.20.0

---


## `@releasekit/release` @ 0.20.0

### New:
- Made publish operation idempotent, allowing safe repeated execution without side effects.

### Fixed:
- **Security**: Replaced exec with execFileSync in e2e test runner to prevent shell injection vulnerabilities.

### Changed:
- Updated LLM provider interfaces and improved message handling for better reliability and consistency.

**Full Changelog**: https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.19.3...releasekit-version-v0.20.0

