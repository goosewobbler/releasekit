# Dart / pub.dev Setup

This guide covers configuring releasekit for Dart and Flutter projects that publish to [pub.dev](https://pub.dev). It applies whether you have a single package, a multi-package Dart workspace, or a mixed npm + Dart monorepo.

See [configuration.md](./configuration.md) for the full config reference.

---

## What's supported

- `pubspec.yaml` version bumping driven by conventional commits — **comments and formatting are preserved** (only the `version:` line is rewritten, including any inline comment)
- Per-package git tags (via `version.packageSpecificTags`)
- Publishing to pub.dev with `dart pub publish` — or `flutter pub publish` for Flutter packages (auto-detected from a `flutter` SDK constraint in the pubspec's `environment`)
- **OIDC automated publishing** from GitHub Actions (no secrets) **or** token auth via `PUB_TOKEN`
- Custom/private registries via `publish_to` in `pubspec.yaml`; packages with `publish_to: none` are skipped automatically
- Idempotent publish: versions already on pub.dev are skipped both before publish (via the pub.dev REST API) and after (via error pattern matching)
- Pre-publish verification: polls pub.dev after each publish to confirm the version is visible
- Explicit publish order override (`publish.pub.publishOrder`)
- `--force` is passed so publishing is non-interactive in CI
- Transient registry errors (timeouts, 5xx, connection resets) are auto-retried per package

## What's not supported

- **Automatic dependency-graph ordering** — unlike the Cargo workspace topological sort, releasekit does not infer publish order from Dart path/workspace dependencies. If one package must publish before another, set `publish.pub.publishOrder` explicitly.
- Automatic package discovery — pubspec directories must be listed in `version.pub.paths` or inferred from `version.packages`.

---

## Quickstart — Dart-only repo

Minimum `releasekit.config.json`:

```json
{
  "$schema": "https://goosewobbler.github.io/releasekit/schema.json",
  "version": {
    "packages": ["./"],
    "pub": {
      "enabled": true
    }
  },
  "publish": {
    "pub": {
      "enabled": true
    }
  }
}
```

`version.pub.enabled` defaults to `true`, so that key is optional but makes intent explicit.

**Important**: `publish.pub.enabled` defaults to `false`. You must set it to `true` explicitly — nothing is published to pub.dev unless you opt in.

Configure authentication via OIDC or `PUB_TOKEN`. See [Auth](#auth) below.

---

## Quickstart — mixed npm + Dart monorepo

Use `version.packages` for npm packages and `version.pub.paths` for Dart packages. Both can coexist:

```json
{
  "$schema": "https://goosewobbler.github.io/releasekit/schema.json",
  "version": {
    "packages": ["packages/js-lib", "packages/cli"],
    "pub": {
      "enabled": true,
      "paths": ["packages/dart-core", "packages/flutter-widget"]
    }
  },
  "publish": {
    "npm": {
      "enabled": true
    },
    "pub": {
      "enabled": true
    }
  }
}
```

When `version.pub.paths` is omitted, releasekit looks for `pubspec.yaml` files alongside the directories listed in `version.packages`. If your Dart packages live in separate directories not listed there, use `version.pub.paths` to point at them explicitly.

---

## Config reference

### `version.pub`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Enable `pubspec.yaml` version bumping |
| `paths` | string[] | — | Directories to search for `pubspec.yaml` files. When omitted, package dirs are inferred from `version.packages` entries that contain a `pubspec.yaml`. |

### `publish.pub`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `false` | Enable publishing to pub.dev. Must be set to `true` explicitly. |
| `publishOrder` | string[] | `[]` | Explicit package publish order by package name. Packages not listed are appended at the end in discovery order. |

### `publish.verify.pub`

Controls how releasekit polls pub.dev after each publish to confirm the version is visible.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Poll pub.dev after publish to verify the version appears. |
| `maxAttempts` | integer | `10` | Maximum number of polling attempts. |
| `initialDelay` | integer (ms) | `30000` | Delay before the first check (30 seconds). |
| `backoffMultiplier` | number | `2` | Exponential backoff multiplier applied between attempts. |

---

## Auth

pub.dev supports two authentication methods. releasekit picks token auth when `PUB_TOKEN` is set, and otherwise assumes OIDC automated publishing.

### Option 1 — OIDC automated publishing (recommended)

No long-lived secret. pub.dev mints a short-lived token from your GitHub Actions OIDC identity.

1. On pub.dev, open your package → **Admin** → **Automated publishing** → enable **publishing from GitHub Actions**, and set the repository and a tag pattern (e.g. `{{version}}` or `*`).
2. Give the workflow `id-token: write` permission (see the workflow example below).

When `PUB_TOKEN` is absent, releasekit runs `dart pub publish` directly and pub picks up the ambient OIDC token.

### Option 2 — token (`PUB_TOKEN`)

Set `PUB_TOKEN` to a pub.dev bearer token. Before publishing, releasekit runs:

```bash
dart pub token add https://pub.dev --env-var PUB_TOKEN
```

so the publish command authenticates from the env var. Store it as a GitHub Actions secret and reference it as `PUB_TOKEN`:

```yaml
env:
  PUB_TOKEN: ${{ secrets.PUB_TOKEN }}
```

With neither OIDC nor `PUB_TOKEN` configured, `dart pub publish` fails with an authentication error.

---

## Publish ordering

releasekit does **not** infer Dart dependency order automatically. Packages publish in discovery order unless you set `publish.pub.publishOrder`:

```json
{
  "publish": {
    "pub": {
      "enabled": true,
      "publishOrder": ["my_core", "my_widgets", "my_app"]
    }
  }
}
```

Packages listed in `publishOrder` are published in that order; any not listed are appended after. Use this when one package depends on another being available on pub.dev first.

---

## GitHub Actions workflow

A minimal release workflow for a Dart-only repository using OIDC automated publishing:

```yaml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: read
  id-token: write # required for pub.dev OIDC automated publishing

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - uses: dart-lang/setup-dart@v1

      # No pnpm/Node setup needed: the bundled goosewobbler/releasekit action brings
      # its own runtime, and a Dart-only repo has no pnpm-lock.yaml (setting cache: pnpm
      # would fail with "Dependencies lock file is not found").
      - name: Run releasekit
        uses: goosewobbler/releasekit@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # For token auth instead of OIDC, set PUB_TOKEN and drop `id-token: write` above:
          # PUB_TOKEN: ${{ secrets.PUB_TOKEN }}
```

`fetch-depth: 0` is required so that releasekit can walk the full commit history to determine the version bump.

For **Flutter** packages, swap (or add) `subosito/flutter-action@v2`, which provides both `flutter` and `dart` on the runner.

---

## Edge cases and troubleshooting

**`dart: command not found`**

The Dart SDK is not pre-installed on GitHub-hosted runners. Add the `dart-lang/setup-dart@v1` step before releasekit runs (see the workflow example above). For Flutter packages, use `subosito/flutter-action@v2` instead — it provides both `flutter` and `dart`.

**Dart vs Flutter**

The publish command is chosen per package: if the pubspec's `environment` includes a `flutter` SDK constraint, releasekit runs `flutter pub publish`; otherwise `dart pub publish`. No configuration is needed.

**Private registries / `publish_to`**

A package with `publish_to: none` is skipped entirely. A package with a custom `publish_to` (a private registry) is published to that server, but the pub.dev idempotency and verification checks are skipped — they only apply to pub.dev targets.

**Publish verification timeout**

pub.dev index propagation can take a little while. If `publish.verify.pub` polls are exhausted before the version appears, increase `maxAttempts` or `initialDelay`:

```json
{
  "publish": {
    "verify": {
      "pub": {
        "maxAttempts": 15,
        "initialDelay": 60000
      }
    }
  }
}
```

**Re-running a partially failed release**

Re-running is safe. releasekit checks pub.dev before each publish via the REST API, and also catches the "already published" error from `dart pub publish` itself. Both paths mark the package as skipped rather than failing the pipeline. Transient registry errors are auto-retried per package before the stage fails, so a brief pub.dev blip rarely needs a manual re-run.

**`pubspec.yaml` parse errors**

A malformed or comment-only `pubspec.yaml` produces a clear `PUBSPEC_YAML_ERROR` rather than a cryptic failure. Ensure each package's pubspec has a `name` and `version`.
