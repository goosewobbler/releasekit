# Getting Started

This guide walks through installing ReleaseKit, verifying your setup with a dry run, and wiring it into CI.

## Prerequisites

- Node.js 20+
- A git repository using [Conventional Commits](https://www.conventionalcommits.org/)
- At least one git tag marking a previous release (e.g. `v0.0.0`), or no tags at all for a first release

---

## 1. Install

Install the unified CLI:

```bash
npm install -g @releasekit/release
# or
pnpm add -g @releasekit/release
```

This provides the `releasekit` command. Individual tools (`releasekit-version`, `releasekit-notes`, `releasekit-publish`) are also available if you need them independently.

---

## 2. Create a config file

Run the init command to create a `releasekit.config.json` with sensible defaults:

```bash
releasekit-notes init
```

Or create it manually. The minimal config for a single-package npm project:

```json
{
  "$schema": "https://goosewobbler.github.io/releasekit/schema.json",
  "notes": {
    "changelog": { "mode": "root" }
  },
  "publish": {
    "npm": { "enabled": true, "access": "public" }
  }
}
```

The `$schema` line enables autocompletion and validation in editors that support JSON Schema.

### Monorepo

For a monorepo with packages under `packages/`, write a changelog per package:

```json
{
  "$schema": "https://goosewobbler.github.io/releasekit/schema.json",
  "notes": {
    "changelog": { "mode": "packages" }
  },
  "publish": {
    "npm": { "enabled": true, "access": "public" }
  }
}
```

---

## 3. Dry run

Before making any real changes, preview what ReleaseKit would do:

```bash
releasekit release --dry-run
```

This runs the full pipeline — version analysis, changelog generation, publish simulation — without writing any files, creating git tags, or publishing packages. Check the output to confirm the version bump and changelog entries look correct.

If nothing is detected, make sure:
- Your commits follow the [Conventional Commits](https://www.conventionalcommits.org/) format (`feat:`, `fix:`, etc.)
- There is at least one commit since the last git tag

---

## 4. First release

When the dry run looks right, run the real thing:

```bash
releasekit release
```

This will:
1. Bump version in `package.json` (and `Cargo.toml` if present)
2. Generate / update `CHANGELOG.md`
3. Create a git commit and tag
4. Publish to npm
5. Push to remote
6. Create a GitHub Release (draft by default)

**npm authentication** — for a local run you need to be logged in to npm:

```bash
npm login
```

Or set `NODE_AUTH_TOKEN` in your environment if you prefer token-based auth:

```bash
NODE_AUTH_TOKEN=npm_... releasekit release
```

**GitHub Release** — set `GITHUB_TOKEN` in your environment:

```bash
GITHUB_TOKEN=ghp_... releasekit release
```

In CI, both tokens are typically available as secrets or via OIDC — see the [CI setup guide](../packages/release/docs/ci-setup.md) for details.

---

## 5. Set up CI

The most common setup triggers a release on every push to `main`. See the [CI setup guide](../packages/release/docs/ci-setup.md) for complete GitHub Actions workflows covering:

- Push-to-main releases
- Label-based triggers (release only when a PR has a `release:patch/minor/major` label)
- npm OIDC trusted publishing (no `NPM_TOKEN` secret required)
- PR preview comments
- Prerelease workflows

### Minimal CI workflow

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: write
  id-token: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npx releasekit release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## Next steps

- **[CI setup guide](../packages/release/docs/ci-setup.md)** — complete workflow recipes
- **[@releasekit/notes — LLM providers](../packages/notes/docs/llm-providers.md)** — add AI-enhanced release notes
- **[@releasekit/notes — configuration](../packages/notes/docs/configuration.md)** — changelog and release notes options
- **[@releasekit/publish — GitHub Releases](../packages/publish/docs/github-releases.md)** — release body options
