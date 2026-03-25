# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [@releasekit/version@0.3.0] - 2026-03-25

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/@releasekit/version@v0.3.0-next.4...@releasekit/version@v0.3.0)

### Added
- push-triggered release workflow (#50)
- **release**: add release preview functionality (#43)
- **release**: add `--branch` option to specify push branch (#46)
- add release pipeline automation configuration (#51)
- rework CLI structure, add dispatcher (#52)
- **notes**: implement ordered category building for enhanced data
- **release**: add changelog preview to release summary
- **notes**: pass user-configured LLM options to provider
- **notes**: enhance JSON extraction from LLM responses
- add GitHub Pages deployment workflow
- **notes**: include package name in changelog version headers
- push-triggered release workflow (#50)
- **release**: add release preview functionality (#43)
- add release pipeline automation configuration (#51)
- rework CLI structure, add dispatcher (#52)

### Changed
- **deps**: bump smol-toml from 1.6.0 to 1.6.1 (#54)
- skip dependabot devdep commits (#55)
- update release workflow to use releasekit from npm (#42)
- upgrade actions/checkout to v6 in CI workflow examples
- **version**: rename package-versioner to releasekit-version
- **version**: remove backwards-compatible alias for BaseVersionError
- **release**: update function names for consistency
- **notes**: rename package-versioner to version output
- **notes**: clean up error handling and imports
- **version**: update tag retrieval to use chronological ordering
- **notes**: remove unused
- **notes**: improve dry run logging for changelog and release notes
- **release**: @releasekit/version, @releasekit/notes, @releasekit/publish, @releasekit/release 0.2.1
- set private packages to 0.0.0
- downgrade package versions
- remove pages.yml from workflow paths to avoid unnecessary schema redeploys
- update README files to clarify configuration setup
- update lockfile
- run package tests on all OSs
- update README files to emphasize ESM support
- ESM only
- enhance package testing workflow in test-packages.ts
- update CI build workflow to pack all core packages
- run package tests on CI
- update tsup configuration to externalize all bare specifiers
- update tsup configuration for all packages to include external dependencies
- update lockfile
- simplify build scripts and add tsup configuration files for all packages
- **deps**: bump dorny/paths-filter from 3 to 4 (#33)
- update GitHub Actions permissions in PR workflow
- remove PLAN.md file
- upgrade actions/checkout to v6 in CI workflow examples
- **version**: rename package-versioner to releasekit-version
- **version**: remove backwards-compatible alias for BaseVersionError
- **version**: update tag retrieval to use chronological ordering
- **release**: @releasekit/version, @releasekit/notes, @releasekit/publish, @releasekit/release 0.2.1
- downgrade package versions
- update README files to emphasize ESM support
- ESM only
- update tsup configuration to externalize all bare specifiers
- update tsup configuration for all packages to include external dependencies
- simplify build scripts and add tsup configuration files for all packages

### Fixed
- **release**: implement shared entry deduplication in release previews (#53)
- update schema URL in releasekit.schema.json
- update command execution in test-packages.ts
- **notes**: improve output labeling for changelogs and release notes
- **release**: implement shared entry deduplication in release previews (#53)

## [@releasekit/notes@0.3.0] - 2026-03-25

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/@releasekit/notes@v0.3.0-next.4...@releasekit/notes@v0.3.0)

### Added
- push-triggered release workflow (#50)
- **release**: add release preview functionality (#43)
- **release**: add `--branch` option to specify push branch (#46)
- add release pipeline automation configuration (#51)
- rework CLI structure, add dispatcher (#52)
- **notes**: implement ordered category building for enhanced data
- **release**: add changelog preview to release summary
- **notes**: pass user-configured LLM options to provider
- **notes**: enhance JSON extraction from LLM responses
- add GitHub Pages deployment workflow
- **notes**: include package name in changelog version headers
- rework CLI structure, add dispatcher (#52)
- **notes**: implement ordered category building for enhanced data
- **notes**: pass user-configured LLM options to provider
- **notes**: enhance JSON extraction from LLM responses
- **notes**: include package name in changelog version headers

### Changed
- **deps**: bump smol-toml from 1.6.0 to 1.6.1 (#54)
- skip dependabot devdep commits (#55)
- update release workflow to use releasekit from npm (#42)
- upgrade actions/checkout to v6 in CI workflow examples
- **version**: rename package-versioner to releasekit-version
- **version**: remove backwards-compatible alias for BaseVersionError
- **release**: update function names for consistency
- **notes**: rename package-versioner to version output
- **notes**: clean up error handling and imports
- **version**: update tag retrieval to use chronological ordering
- **notes**: remove unused
- **notes**: improve dry run logging for changelog and release notes
- **release**: @releasekit/version, @releasekit/notes, @releasekit/publish, @releasekit/release 0.2.1
- set private packages to 0.0.0
- downgrade package versions
- remove pages.yml from workflow paths to avoid unnecessary schema redeploys
- update README files to clarify configuration setup
- update lockfile
- run package tests on all OSs
- update README files to emphasize ESM support
- ESM only
- enhance package testing workflow in test-packages.ts
- update CI build workflow to pack all core packages
- run package tests on CI
- update tsup configuration to externalize all bare specifiers
- update tsup configuration for all packages to include external dependencies
- update lockfile
- simplify build scripts and add tsup configuration files for all packages
- **deps**: bump dorny/paths-filter from 3 to 4 (#33)
- update GitHub Actions permissions in PR workflow
- remove PLAN.md file
- **notes**: rename package-versioner to version output
- **notes**: clean up error handling and imports
- **notes**: remove unused
- **notes**: improve dry run logging for changelog and release notes
- **release**: @releasekit/version, @releasekit/notes, @releasekit/publish, @releasekit/release 0.2.1
- downgrade package versions
- update README files to emphasize ESM support
- ESM only
- update tsup configuration to externalize all bare specifiers
- update tsup configuration for all packages to include external dependencies
- simplify build scripts and add tsup configuration files for all packages
- remove PLAN.md file

### Fixed
- **release**: implement shared entry deduplication in release previews (#53)
- update schema URL in releasekit.schema.json
- update command execution in test-packages.ts
- **notes**: improve output labeling for changelogs and release notes
- **notes**: improve output labeling for changelogs and release notes

## [@releasekit/publish@0.3.0] - 2026-03-25

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/@releasekit/publish@v0.3.0-next.4...@releasekit/publish@v0.3.0)

### Added
- push-triggered release workflow (#50)
- **release**: add release preview functionality (#43)
- **release**: add `--branch` option to specify push branch (#46)
- add release pipeline automation configuration (#51)
- rework CLI structure, add dispatcher (#52)
- **notes**: implement ordered category building for enhanced data
- **release**: add changelog preview to release summary
- **notes**: pass user-configured LLM options to provider
- **notes**: enhance JSON extraction from LLM responses
- add GitHub Pages deployment workflow
- **notes**: include package name in changelog version headers
- push-triggered release workflow (#50)
- **release**: add `--branch` option to specify push branch (#46)
- rework CLI structure, add dispatcher (#52)

### Changed
- **deps**: bump smol-toml from 1.6.0 to 1.6.1 (#54)
- skip dependabot devdep commits (#55)
- update release workflow to use releasekit from npm (#42)
- upgrade actions/checkout to v6 in CI workflow examples
- **version**: rename package-versioner to releasekit-version
- **version**: remove backwards-compatible alias for BaseVersionError
- **release**: update function names for consistency
- **notes**: rename package-versioner to version output
- **notes**: clean up error handling and imports
- **version**: update tag retrieval to use chronological ordering
- **notes**: remove unused
- **notes**: improve dry run logging for changelog and release notes
- **release**: @releasekit/version, @releasekit/notes, @releasekit/publish, @releasekit/release 0.2.1
- set private packages to 0.0.0
- downgrade package versions
- remove pages.yml from workflow paths to avoid unnecessary schema redeploys
- update README files to clarify configuration setup
- update lockfile
- run package tests on all OSs
- update README files to emphasize ESM support
- ESM only
- enhance package testing workflow in test-packages.ts
- update CI build workflow to pack all core packages
- run package tests on CI
- update tsup configuration to externalize all bare specifiers
- update tsup configuration for all packages to include external dependencies
- update lockfile
- simplify build scripts and add tsup configuration files for all packages
- **deps**: bump dorny/paths-filter from 3 to 4 (#33)
- update GitHub Actions permissions in PR workflow
- remove PLAN.md file
- **release**: @releasekit/version, @releasekit/notes, @releasekit/publish, @releasekit/release 0.2.1
- downgrade package versions
- update README files to emphasize ESM support
- ESM only
- update tsup configuration to externalize all bare specifiers
- update tsup configuration for all packages to include external dependencies
- simplify build scripts and add tsup configuration files for all packages

### Fixed
- **release**: implement shared entry deduplication in release previews (#53)
- update schema URL in releasekit.schema.json
- update command execution in test-packages.ts
- **notes**: improve output labeling for changelogs and release notes

## [@releasekit/release@0.3.0] - 2026-03-25

[Full Changelog](https://github.com/goosewobbler/releasekit/compare/@releasekit/release@v0.3.0-next.4...@releasekit/release@v0.3.0)

### Added
- push-triggered release workflow (#50)
- **release**: add release preview functionality (#43)
- **release**: add `--branch` option to specify push branch (#46)
- add release pipeline automation configuration (#51)
- rework CLI structure, add dispatcher (#52)
- **notes**: implement ordered category building for enhanced data
- **release**: add changelog preview to release summary
- **notes**: pass user-configured LLM options to provider
- **notes**: enhance JSON extraction from LLM responses
- add GitHub Pages deployment workflow
- **notes**: include package name in changelog version headers
- push-triggered release workflow (#50)
- **release**: add release preview functionality (#43)
- **release**: add `--branch` option to specify push branch (#46)
- add release pipeline automation configuration (#51)
- rework CLI structure, add dispatcher (#52)
- **release**: add changelog preview to release summary

### Changed
- **deps**: bump smol-toml from 1.6.0 to 1.6.1 (#54)
- skip dependabot devdep commits (#55)
- update release workflow to use releasekit from npm (#42)
- upgrade actions/checkout to v6 in CI workflow examples
- **version**: rename package-versioner to releasekit-version
- **version**: remove backwards-compatible alias for BaseVersionError
- **release**: update function names for consistency
- **notes**: rename package-versioner to version output
- **notes**: clean up error handling and imports
- **version**: update tag retrieval to use chronological ordering
- **notes**: remove unused
- **notes**: improve dry run logging for changelog and release notes
- **release**: @releasekit/version, @releasekit/notes, @releasekit/publish, @releasekit/release 0.2.1
- set private packages to 0.0.0
- downgrade package versions
- remove pages.yml from workflow paths to avoid unnecessary schema redeploys
- update README files to clarify configuration setup
- update lockfile
- run package tests on all OSs
- update README files to emphasize ESM support
- ESM only
- enhance package testing workflow in test-packages.ts
- update CI build workflow to pack all core packages
- run package tests on CI
- update tsup configuration to externalize all bare specifiers
- update tsup configuration for all packages to include external dependencies
- update lockfile
- simplify build scripts and add tsup configuration files for all packages
- **deps**: bump dorny/paths-filter from 3 to 4 (#33)
- update GitHub Actions permissions in PR workflow
- remove PLAN.md file
- upgrade actions/checkout to v6 in CI workflow examples
- **release**: update function names for consistency
- **release**: @releasekit/version, @releasekit/notes, @releasekit/publish, @releasekit/release 0.2.1
- downgrade package versions
- update README files to clarify configuration setup
- update README files to emphasize ESM support
- ESM only
- update tsup configuration to externalize all bare specifiers
- update tsup configuration for all packages to include external dependencies
- simplify build scripts and add tsup configuration files for all packages

### Fixed
- **release**: implement shared entry deduplication in release previews (#53)
- update schema URL in releasekit.schema.json
- update command execution in test-packages.ts
- **notes**: improve output labeling for changelogs and release notes
- **release**: implement shared entry deduplication in release previews (#53)
