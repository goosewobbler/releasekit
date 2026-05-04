# Cargo / Rust Setup

This guide covers configuring releasekit for Rust projects that publish to crates.io. It applies whether you have a pure Rust repo, a Cargo workspace, or a mixed npm + Rust monorepo.

See [configuration.md](./configuration.md) for the full config reference.

---

## What's supported

- `Cargo.toml` version bumping driven by conventional commits
- Per-crate git tags (via `version.packageSpecificTags`)
- Publishing to crates.io with `cargo publish`
- Workspace dependency ordering via topological sort (Kahn's algorithm) so path-dependent crates are published in the correct sequence
- Idempotent publish: crates already present on crates.io are silently skipped both before publish (via the crates.io API) and after (via error pattern matching, to handle sparse index lag)
- Pre-publish verification: polls crates.io after each publish to confirm the version is visible
- `--allow-dirty` automatically passed when the git working directory has uncommitted changes (expected after a version bump commit)
- Optional `cargo clean` before publish (`publish.cargo.clean`)
- Explicit publish order override (`publish.cargo.publishOrder`) when the automatic sort is insufficient

## What's not supported

- OIDC / trusted publishing for crates.io — token-based auth only via `CARGO_REGISTRY_TOKEN`
- Automatic workspace root discovery — crate directories must be listed in `version.cargo.paths` or inferred from `version.packages`
- Comment and formatting preservation in `Cargo.toml` — the file is rewritten on version bump using `smol-toml`'s serialiser; whitespace, comments, and key order may change

---

## Quickstart — Rust-only repo

Minimum `releasekit.config.json`:

```json
{
  "$schema": "https://goosewobbler.github.io/releasekit/schema.json",
  "version": {
    "packages": ["./"],
    "cargo": {
      "enabled": true
    }
  },
  "publish": {
    "cargo": {
      "enabled": true
    }
  }
}
```

`version.cargo.enabled` defaults to `true`, so that key is optional but makes intent explicit.

**Important**: `publish.cargo.enabled` defaults to `false`. You must set it to `true` explicitly — nothing is published to crates.io unless you opt in.

Set `CARGO_REGISTRY_TOKEN` in your CI secrets. See [Auth](#auth) below.

---

## Quickstart — mixed npm + Rust monorepo

Use `version.packages` for npm packages and `version.cargo.paths` for Rust crates. Both can coexist:

```json
{
  "$schema": "https://goosewobbler.github.io/releasekit/schema.json",
  "version": {
    "packages": ["packages/js-lib", "packages/cli"],
    "cargo": {
      "enabled": true,
      "paths": ["crates/core", "crates/ffi"]
    }
  },
  "publish": {
    "npm": {
      "enabled": true
    },
    "cargo": {
      "enabled": true
    }
  }
}
```

When `version.cargo.paths` is omitted, releasekit looks for `Cargo.toml` files alongside the directories listed in `version.packages`. If your Rust crates live in separate directories not listed there, use `version.cargo.paths` to point at them explicitly.

---

## Config reference

### `version.cargo`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Enable `Cargo.toml` version bumping |
| `paths` | string[] | — | Directories to search for `Cargo.toml` files. When omitted, crate dirs are inferred from `version.packages` entries that contain a `Cargo.toml`. |

### `publish.cargo`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `false` | Enable publishing to crates.io. Must be set to `true` explicitly. |
| `noVerify` | boolean | `false` | Pass `--no-verify` to `cargo publish`, skipping pre-publish tarball verification. Use only as a workaround — see [Edge cases](#edge-cases-and-troubleshooting). |
| `publishOrder` | string[] | `[]` | Explicit crate publish order by crate name. When set, this overrides the automatic topological sort. Crates not listed are appended at the end. |
| `clean` | boolean | `false` | Run `cargo clean` in the crate directory before publishing. |

### `publish.verify.cargo`

Controls how releasekit polls crates.io after each publish to confirm the version is visible. crates.io index propagation is slower than npm, so the defaults are more conservative.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Poll crates.io after publish to verify the version appears. |
| `maxAttempts` | integer | `10` | Maximum number of polling attempts. |
| `initialDelay` | integer (ms) | `30000` | Delay before the first check (30 seconds). |
| `backoffMultiplier` | number | `2` | Exponential backoff multiplier applied between attempts. |

---

## Auth

releasekit requires a crates.io API token set as `CARGO_REGISTRY_TOKEN`. There is no OIDC alternative for crates.io at this time.

**Generating a token:**

1. Log in to [crates.io](https://crates.io) and go to **Account Settings → API Tokens**.
2. Create a new token with the **Publish new crates** and **Publish updates** scopes.
3. Copy the token — it is shown only once.

**Storing it in GitHub Actions:**

1. Go to your repository → **Settings → Secrets and variables → Actions**.
2. Add a new secret named `CARGO_REGISTRY_TOKEN` and paste the token value.
3. Reference it in your workflow:

```yaml
env:
  CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN }}
```

releasekit checks for this environment variable at the start of the cargo publish stage and fails immediately if it is absent (unless `--dry-run` is active).

---

## Publish ordering

When publishing a Cargo workspace, crates that are path dependencies of other crates must be published first. releasekit resolves this automatically using a topological sort (Kahn's algorithm) over the path dependency graph.

Only `[dependencies]` / `[dev-dependencies]` / `[build-dependencies]` entries with a `path` key are used for ordering. Registry dependencies (version strings or `{ version = "..." }`) and git dependencies are not included in the graph — those are already available on crates.io before the release starts.

**When to use `publishOrder` explicitly:**

- A crate depends on another via the registry (not a path dep) but you still need to control sequencing — e.g. when publishing a new major of a shared library alongside a consumer crate.
- You have a circular path dependency workaround that the topological sort cannot resolve.

```json
{
  "publish": {
    "cargo": {
      "enabled": true,
      "publishOrder": ["my-core", "my-derive", "my-lib"]
    }
  }
}
```

Crates listed in `publishOrder` are published in that order. Any crates not listed are appended after in auto-sorted order.

---

## GitHub Actions workflow

A minimal release workflow for a Rust-only repository:

```yaml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: read

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - uses: dtolnay/rust-toolchain@stable

      - uses: actions/setup-node@v6
        with:
          node-version: '20'

      - name: Run releasekit
        uses: goosewobbler/releasekit@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN }}
```

`fetch-depth: 0` is required so that releasekit can walk the full commit history to determine the version bump.

---

## Edge cases and troubleshooting

**`error: failed to verify package tarball`**

`cargo publish` runs a pre-publish verification step that builds the crate from the packaged tarball. This can fail in some environments (missing system libraries, conflicting feature flags, etc.). As a workaround, set `publish.cargo.noVerify: true` to pass `--no-verify` — but note that this skips all pre-publish checks, so it is best treated as a temporary measure rather than a permanent setting.

**Dirty working directory after version bump**

This is expected behaviour. releasekit bumps the version in `Cargo.toml`, commits the change, and then runs the publish stage. At publish time the release commit exists but the working directory may still be considered dirty by cargo (the index has not been updated). releasekit detects this via `git status --porcelain` and automatically appends `--allow-dirty` to the publish command.

**`cargo: command not found`**

The Rust toolchain is not pre-installed on GitHub-hosted runners. Add the `dtolnay/rust-toolchain@stable` step before releasekit runs (see the workflow example above). For more control over the toolchain version, use the `toolchain` input:

```yaml
- uses: dtolnay/rust-toolchain@stable
  with:
    toolchain: '1.78'
```

**Publish verification timeout**

crates.io index propagation can take several minutes. If `publish.verify.cargo` polls are exhausted before the version appears, increase `maxAttempts` or `initialDelay`:

```json
{
  "publish": {
    "verify": {
      "cargo": {
        "maxAttempts": 15,
        "initialDelay": 60000
      }
    }
  }
}
```

**Re-running a partially failed release**

If a release run fails mid-way through a multi-crate workspace, re-running is safe. releasekit checks crates.io before each publish via the API, and also catches the `already exists on crates.io index` error from `cargo publish` itself (to handle sparse index lag). Both paths mark the crate as skipped rather than failing the pipeline.
