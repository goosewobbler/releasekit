# Changelog Generation

`package-versioner` automatically generates and maintains a [Keep a Changelog](https://keepachangelog.com/) or Angular-style changelog for each package in your project.

## How It Works

1. When a package is versioned, `package-versioner` scans the git history since the last release tag.
2. It parses conventional commit messages and sorts them into appropriate changelog sections:
   - `feat` prefixed commits become "Added" entries
   - `fix` prefixed commits become "Fixed" entries
   - `deprecate` prefixed commits become "Deprecated" entries
   - `refactor`, `style`, `perf`, `build`, `ci` become "Changed" entries
   - `revert` becomes "Removed" entries
   - Any commits with `!` after the type or containing `BREAKING CHANGE:` text get a **BREAKING** prefix
   - Other commit types are mapped to sensible defaults

## Changelog Structure

The generated changelogs follow the Keep a Changelog structure:

- An "Unreleased" section for tracking upcoming changes
- Version sections with release dates and sorted entries
- Entries grouped by type (Added, Changed, Fixed, etc.)
- Automatic linking between versions if repository info is available
- Smart detection of issue references (like `Fixes #123`)

## Changelog Formats

`package-versioner` supports two changelog formats:

1. **Keep a Changelog** (default): A standard format following [keepachangelog.com](https://keepachangelog.com/) conventions
2. **Angular**: A format similar to that used by Angular projects

You can configure the preferred format in your `version.config.json`:

```json
{
  "writeChangelog": true,
  "changelogFormat": "keep-a-changelog" // or "angular"
}
```

## Customization Options

- **Enable/Disable**: Set `writeChangelog: false` in your config to disable changelog file generation (changelog data is still available via `--json`)
- **Format Selection**: Use `changelogFormat` to choose between "keep-a-changelog" or "angular"
- **Repository URL**: Automatically detected from package.json, or can be configured explicitly
- **Issue References**: Commit messages containing `fixes #123` or similar will link issues in the changelog

## Regenerating Changelogs

For projects with existing history, you can regenerate a complete changelog from scratch using the CLI:

```bash
# Generate changelog in current directory
npx package-versioner changelog --regenerate

# Generate changelog in a specific directory
npx package-versioner changelog --regenerate --project-dir /path/to/project

# Customize output path and format
npx package-versioner changelog --regenerate --output CHANGELOG.md --format keep-a-changelog
```

This will scan your entire git history and create a comprehensive changelog based on all version tags found in your repository.

## Tips for Better Changelogs

- Use conventional commit format (`type(scope): message`) for consistent changelog entries
- Include issue references in commits (`fixes #123`) to automatically link related issues
- Add `BREAKING CHANGE:` in commit bodies when introducing breaking changes
- Keep commit messages clear and user-focused for better changelog readability
