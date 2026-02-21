# Versioning Strategies and Concepts

`package-versioner` offers flexible ways to determine the next version for your project based on its history and your configuration.

## How the Next Version is Calculated

There are two primary methods the tool uses to decide the version bump (e.g., patch, minor, major), configured via the `versionStrategy` option in `version.config.json`:

### 1. Conventional Commits (`versionStrategy: "conventional"`)

This is the default strategy. `package-versioner` analyzes Git commit messages since the last Git tag that follows semver patterns. It uses the [conventional-commits](https://www.conventionalcommits.org/) specification to determine the bump:

-   **Patch Bump (e.g., 1.2.3 -> 1.2.4):** Triggered by `fix:` commit types.
-   **Minor Bump (e.g., 1.2.3 -> 1.3.0):** Triggered by `feat:` commit types.
-   **Major Bump (e.g., 1.2.3 -> 2.0.0):** Triggered by commits with `BREAKING CHANGE:` in the footer or `feat!:`, `fix!:` etc. in the header.

The specific preset used for analysis (e.g., "angular", "conventional") can be set using the `preset` option in `version.config.json`.

**Format:** `<type>(<scope>): <subject>`

`<scope>` is optional.

**Example Commit Types:**

-   `feat:` (new feature for the user)
-   `fix:` (bug fix for the user)
-   `docs:` (changes to the documentation)
-   `style:` (formatting, missing semi-colons, etc; no production code change)
-   `refactor:` (refactoring production code, e.g. renaming a variable)
-   `test:` (adding missing tests, refactoring tests; no production code change)
-   `chore:` (updating build tasks etc; no production code change)

**References:**

-   [https://www.conventionalcommits.org/](https://www.conventionalcommits.org/)
-   [https://github.com/conventional-changelog/conventional-changelog](https://github.com/conventional-changelog/conventional-changelog)

### 2. Branch Pattern (`versionStrategy: "branchPattern"`)

This strategy uses the name of the current Git branch (or the most recently merged branch matching a pattern, if applicable) to determine the version bump.

You define patterns in the `branchPattern` array in `version.config.json`. Each pattern is a string like `"prefix:bumptype"`.

**Example `version.config.json`:**

```json
{
  "versionStrategy": "branchPattern",
  "branchPattern": [
    "feature:minor",
    "hotfix:patch",
    "fix:patch",
    "release:major" 
  ],
  "baseBranch": "main" 
}
```

**How it works:**

1.  The tool checks the current branch name.
2.  It might also look for the most recently merged branch into `baseBranch` that matches any pattern in `branchPattern`.
3.  It compares the relevant branch name (current or last merged) against the prefixes in `branchPattern`.
4.  If a match is found (e.g., current branch is `feature/add-login`), it applies the corresponding bump type (`minor` in this case).

This allows you to enforce version bumps based on your branching workflow (e.g., all branches starting with `feature/` result in a minor bump).

## Package Type Support

`package-versioner` supports both JavaScript/TypeScript projects using `package.json` and Rust projects using `Cargo.toml`:

### JavaScript/TypeScript Projects

For JavaScript/TypeScript projects, the tool looks for and updates the `version` field in `package.json` files according to the versioning strategies described above.

### Rust Projects

For Rust projects, the tool looks for and updates the `package.version` field in `Cargo.toml` files using the same versioning strategies.

### Mixed Projects with Both Manifests

When both `package.json` and `Cargo.toml` exist in the same directory, `package-versioner` will:

1. Update both manifest files independently with the same calculated version
2. First check `package.json` for the current version (when no tags exist)
3. Fall back to checking `Cargo.toml` only if `package.json` doesn't exist or doesn't have a version

This allows you to maintain consistent versioning across JavaScript and Rust components in the same package.

## Version Source Selection

`package-versioner` uses a smart version source selection strategy to determine the base version for calculating the next version:

1. First, it checks for Git tags:
   - In normal mode: Uses the latest reachable tag, falling back to unreachable tags if needed
   - In strict mode (`--strict-reachable`): Only uses reachable tags
   
2. Then, it checks manifest files (package.json, Cargo.toml):
   - Reads version from package.json if it exists
   - Falls back to Cargo.toml if package.json doesn't exist or has no version
   
3. Finally, it compares the versions:
   - If both Git tag and manifest versions exist, it uses the newer version
   - If the versions are equal, it prefers the Git tag for better history tracking
   - If only one source has a version, it uses that
   - If no version is found, it uses the default initial version (0.1.0)

This strategy ensures that:
- Version numbers never go backwards
- Git history is respected when possible
- Manifest files are considered as valid version sources
- The tool always has a valid base version to work from

For example:
```
Scenario 1:
- Git tag: v1.0.0
- package.json: 1.1.0
Result: Uses 1.1.0 as base (package.json is newer)

Scenario 2:
- Git tag: v1.0.0
- package.json: 1.0.0
Result: Uses v1.0.0 as base (versions equal, prefer Git)

Scenario 3:
- Git tag: unreachable v2.0.0
- package.json: 1.0.0
Result: Uses 2.0.0 as base in normal mode (unreachable tag is newer)
        Uses 1.0.0 as base in strict mode (unreachable tag ignored)
```

### Version Mismatch Detection

When Git tags and manifest versions diverge significantly, it can lead to unexpected version bumps. A common scenario is when a release is reverted but its Git tag is not deleted — the tool sees the tag as the latest version and bumps from there.

For example:
```
- Git tag: v1.0.0 (from a reverted release)
- package.json: 1.0.0-beta.3
- Without mismatch detection: Uses v1.0.0 as base, next release bumps to v2.0.0
```

The `mismatchStrategy` option controls how these situations are handled:

| Strategy | Behavior |
|----------|----------|
| `"error"` (default) | Throws an error and stops execution, forcing the user to resolve the mismatch |
| `"warn"` | Logs a warning describing the mismatch, then continues with the higher version |
| `"prefer-package"` | Uses the package.json version as the base when a mismatch is detected |
| `"prefer-git"` | Uses the git tag version as the base when a mismatch is detected |
| `"ignore"` | Silently continues with the higher version (pre-v0.9.4 behavior) |

Mismatches are detected in the following cases:
- Git tag is a stable release but package.json is a prerelease of the same major version (e.g., tag `1.0.0` vs package `1.0.0-beta.3`)
- Git tag is ahead by a major or minor version (e.g., tag `2.0.0` vs package `1.0.0`)
- Git tag is a prerelease but package.json is a stable release (e.g., tag `1.0.0-beta.1` vs package `1.0.0`)

Configure it in `version.config.json`:
```json
{
  "mismatchStrategy": "prefer-package"
}
```

## Package Targeting in Monorepos

When working with monorepos, you can control which packages are processed for versioning using the `packages` configuration option. This provides flexible targeting with support for various pattern types.

### Targeting Patterns

#### Exact Package Names
Target specific packages by their exact names:
```json
{
  "packages": ["@mycompany/core", "@mycompany/utils", "standalone-package"]
}
```

#### Scope Wildcards
Target all packages within a specific scope:
```json
{
  "packages": ["@mycompany/*"]
}
```
This will match all packages whose names start with `@mycompany/`.

#### Global Wildcard
Target all packages in the workspace:
```json
{
  "packages": ["*"]
}
```

#### Mixed Patterns
Target different types of packages using a combination of patterns:
```json
{
  "packages": ["@mycompany/*", "@utils/logger", "legacy-package"]
}
```

### Skip Patterns

The `skip` configuration option allows you to exclude specific packages from versioning using the same pattern matching capabilities as package targeting.

#### Pattern Types

1. **Exact Package Names**
```json
{
  "skip": ["@internal/docs", "test-utils"]
}
```

2. **Scope Wildcards**
```json
{
  "skip": ["@internal/*"]
}
```
This will skip all packages whose names start with `@internal/`.

3. **Path Patterns**
```json
{
  "skip": ["packages/**/test-*", "examples/**/*"]
}
```
This will skip packages matching the specified path patterns.

4. **Mixed Patterns**
```json
{
  "skip": ["@internal/*", "test-*", "packages/examples/**/*"]
}
```

#### Skip Pattern Priority

Skip patterns take precedence over include patterns. If a package matches both a pattern in `packages` and a pattern in `skip`, it will be excluded from versioning.

Example:
```json
{
  "packages": ["@company/*"],
  "skip": ["@company/internal-*"]
}
```
In this case, all packages under the `@company` scope will be versioned except those starting with `@company/internal-`.

### Behaviour

- **When `packages` is specified**: Only packages matching those patterns will be processed for versioning
- **When `packages` is empty or not specified**: All workspace packages will be processed
- **Error handling**: If no packages match the specified patterns, a warning is displayed

### Excluding Packages

Use the `skip` option to exclude specific packages from processing:
```json
{
  "packages": ["@mycompany/*"],
  "skip": ["@mycompany/deprecated-package"]
}
```

This configuration will process all packages in the `@mycompany` scope except for `@mycompany/deprecated-package`.

**Note**: Your workspace configuration (pnpm-workspace.yaml, package.json workspaces, etc.) determines which packages are available in your workspace, but the `packages` option directly controls which ones get versioned.

## Tag Templates and Configuration

`package-versioner` provides flexible configuration for how Git tags are formatted, allowing you to customize the tag structure for both single package repositories and monorepos.

### Tag Template Configuration

You can customize how tags are formatted using the following configuration options in `version.config.json`:

```json
{
  "versionPrefix": "v",
  "tagTemplate": "${prefix}${version}",
  "packageSpecificTags": false
}
```

- **versionPrefix**: The prefix used for all version numbers in tags (default: `"v"`)
- **tagTemplate**: The template for Git tags (default: `"${prefix}${version}"`)
- **packageSpecificTags**: Whether to enable package-specific tagging behaviour (default: `false`)

### Available Template Variables

The tag template supports the following variables:

- `${prefix}`: Replaced with the value of `versionPrefix`
- `${version}`: Replaced with the calculated version number
- `${packageName}`: Replaced with the package name (only populated when `packageSpecificTags` is `true`)

### How Package-Specific Tagging Works

The `packageSpecificTags` option controls whether the `${packageName}` variable is populated in your template:

- **When `packageSpecificTags` is `false`**: The `${packageName}` variable is empty, so use templates like `${prefix}${version}`
- **When `packageSpecificTags` is `true`**: The `${packageName}` variable contains the actual package name

### Examples

#### Global Versioning (Default)
```json
{
  "versionPrefix": "v",
  "tagTemplate": "${prefix}${version}",
  "packageSpecificTags": false
}
```
This produces tags like `v1.2.3` for all packages.

#### Package-Specific Versioning
```json
{
  "versionPrefix": "v",
  "tagTemplate": "${packageName}@${prefix}${version}",
  "packageSpecificTags": true
}
```
This produces tags like `@scope/package-name@v1.2.3` for each package.

#### Custom Tag Format Examples
```json
{
  "versionPrefix": "",
  "tagTemplate": "release-${version}",
  "packageSpecificTags": false
}
```
This would produce tags like `release-1.2.3` instead of `v1.2.3`.

```json
{
  "versionPrefix": "v",
  "tagTemplate": "${packageName}-${prefix}${version}",
  "packageSpecificTags": true
}
```
This would produce package tags like `@scope/package-name-v1.2.3` instead of `@scope/package-name@v1.2.3`. 

### Behaviour in Different Modes

- **Synced Mode with Single Package**: When `packageSpecificTags` is `true`, the package name is used even though all packages are versioned together
- **Synced Mode with Multiple Packages**: Package names are not used regardless of the `packageSpecificTags` setting
- **Async Mode**: Each package gets its own tag when `packageSpecificTags` is enabled

## Troubleshooting Template Configuration

`package-versioner` provides helpful warnings when template configurations don't match your project setup. Here are common issues and their solutions:

### Template Contains ${packageName} but No Package Name Available

If you see this warning, it means your template includes `${packageName}` but the tool cannot determine a package name for the current context.

**Example Warning:**
```
Warning: Your tagTemplate contains ${packageName} but no package name is available.
This will result in an empty package name in the tag (e.g., "@v1.0.0" instead of "my-package@v1.0.0").

To fix this:
• If using sync mode: Set "packageSpecificTags": true in your config to enable package names in tags
• If you want global tags: Remove ${packageName} from your tagTemplate (e.g., use "${prefix}${version}")
• If using single/async mode: Ensure your package.json has a valid "name" field
```

**Solutions:**

1. **For Synced Mode with Package Names**: Enable package-specific tags
   ```json
   {
     "sync": true,
     "packageSpecificTags": true,
     "tagTemplate": "${packageName}@${prefix}${version}"
   }
   ```

2. **For Global Tags**: Remove `${packageName}` from your template
   ```json
   {
     "tagTemplate": "${prefix}${version}",
     "packageSpecificTags": false
   }
   ```

3. **For Single/Async Mode**: Ensure your `package.json` has a valid `name` field
   ```json
   {
     "name": "my-package",
     "version": "1.0.0"
   }
   ```

### Common Template Patterns

Here are some common template patterns and when to use them:

| Pattern | Use Case | Example Output |
|---------|----------|----------------|
| `"${prefix}${version}"` | Global versioning, all packages get same tag | `v1.2.3` |
| `"${packageName}@${prefix}${version}"` | Package-specific versioning | `@scope/package@v1.2.3` |
| `"release-${version}"` | Custom release format | `release-1.2.3` |
| `"${packageName}-${version}"` | Simple package versioning | `@scope/package-1.2.3` |

### Commit Message Templates

The same principles apply to `commitMessage` templates. If your commit message template includes `${packageName}`, ensure that package names are available in your current mode:

```json
{
  "commitMessage": "chore: release ${packageName}@${version}",
  "packageSpecificTags": true
}
```

For global commit messages, use templates without `${packageName}`:
```json
{
  "commitMessage": "chore: release ${version}"
}
```

## Monorepo Versioning Modes

While primarily used for single packages now, `package-versioner` retains options for monorepo workflows, controlled mainly by the `sync` flag in `version.config.json`.

### Sync Mode (`sync: true`)

This is the default if the `sync` flag is present and true.

-   **Behaviour:** The tool calculates **one** version bump based on the overall history (or branch pattern). This single new version is applied to **all** packages within the repository (or just the root `package.json` if not a structured monorepo). A single Git tag is created.
-   **Tag Behaviour:** 
    - In **multi-package monorepos**: Creates global tags like `v1.2.3` regardless of `packageSpecificTags` setting
    - In **single-package repositories**: Respects the `packageSpecificTags` setting - can create either `v1.2.3` or `package-name@v1.2.3`
-   **Use Case:** Suitable for monorepos where all packages are tightly coupled and released together with the same version number. Also the effective mode for single-package repositories.

### Async Mode (`sync: false`)

*(Note: This mode relies heavily on monorepo tooling and structure, like `pnpm workspaces` and correctly configured package dependencies.)*

-   **Behaviour (Default - No `-t` flag):** The tool analyzes commits to determine which specific packages within the monorepo have changed since the last relevant commit/tag.
    -   It calculates an appropriate version bump **independently for each changed package** based on the commits affecting that package.
    -   Only the `package.json` files of the changed packages are updated.
    -   A **single commit** is created grouping all the version bumps, using the commit message template. **No Git tags are created** in this mode.
-   **Use Case:** Suitable for monorepos where packages are versioned independently, but a single commit represents the batch of updates for traceability.

-   **Behaviour (Targeted - With `-t` flag):** When using the `-t, --target <targets>` flag:
    -   Only the specified packages (respecting the `skip` list) are considered for versioning.
    -   It calculates an appropriate version bump **independently for each targeted package** based on its commit history.
    -   The `package.json` file of each successfully updated targeted package is modified.
    -   An **individual Git tag** (e.g., `packageName@1.2.3`) is created **for each successfully updated package** immediately after its version is bumped.
    -   Finally, a **single commit** is created including all the updated `package.json` files, using a summary commit message (e.g., `chore(release): pkg-a, pkg-b 1.2.3 [skip-ci]`).
    -   **Important:** Only package-specific tags are created. The global tag (e.g., `v1.2.3`) is **not** automatically generated in this mode. If your release process (like GitHub Releases) depends on a global tag, you'll need to create it manually in your CI/CD script *after* `package-versioner` completes.
-   **Use Case:** Releasing specific packages independently while still tagging each released package individually.

## Prerelease Handling

`package-versioner` provides flexible handling for prerelease versions, allowing both creation of prereleases and promotion to stable releases.

### Creating Prereleases

Use the `--prerelease` flag with an identifier to create a prerelease version:

```bash
# Create a beta prerelease
npx package-versioner --bump minor --prerelease beta
# Result: 1.0.0 -> 1.1.0-beta.0
```

You can also set a default prerelease identifier in your `version.config.json`:

```json
{
  "prereleaseIdentifier": "beta"
}
```

### Promoting Prereleases to Stable Releases

When using standard bump types (`major`, `minor`, `patch`) with the `--bump` flag on a prerelease version, `package-versioner` will automatically clean the prerelease identifier:

```bash
# Starting from version 1.0.0-beta.1
npx package-versioner --bump major
# Result: 1.0.0-beta.1 -> 2.0.0 (not 2.0.0-beta.0)
```

This intuitive behaviour means you don't need to use an empty prerelease identifier (`--prerelease ""`) to promote a prerelease to a stable version. Simply specify the standard bump type and the tool will automatically produce a clean version number.

This applies to all standard bump types:
- `--bump major`: 1.0.0-beta.1 -> 2.0.0
- `--bump minor`: 1.0.0-beta.1 -> 1.1.0 
- `--bump patch`: 1.0.0-beta.1 -> 1.0.1