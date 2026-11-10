# Dart / pub.dev Setup

This guide covers configuring releasekit for Dart and Flutter projects that publish to [pub.dev](https://pub.dev). It applies whether you have a single package, a multi-package Dart workspace, or a mixed npm + Dart monorepo.

See [configuration.md](./configuration.md) for the full config reference.

---

## What's supported

- `pubspec.yaml` version bumping driven by conventional commits — **comments and formatting are preserved** (only the `version:` line is rewritten, including any inline comment)
- Per-package git tags (via `version.packageSpecificTags`)
- Publishing to pub.dev with `dart pub publish` — or `flutter pub publish` for Flutter packages (auto-detected from a `flutter` SDK constraint in the pubspec's `environment`)
- **OIDC automated publishing** from GitHub Actions (no secrets) **or** token auth via `PUB_TOKEN`
- Custom/private registries via `publish_to` in `pubspec.yaml`
- A pubspec with `publish_to: none` or no `version` (a Dart workspace root or app manifest) is never bumped or published
- Idempotent publish: versions already on pub.dev are skipped both before publish (via the pub.dev REST API) and after (via error pattern matching)
- Pre-publish verification: polls pub.dev after each publish to confirm the version is visible
- Explicit publish order override (`publish.pub.publishOrder`)
- `--force` is passed so publishing is non-interactive in CI
- Transient registry errors (timeouts, 5xx, connection resets) are auto-retried per package

## What's not supported

- **Automatic dependency-graph ordering** — unlike the Cargo workspace topological sort, releasekit does not infer publish order from Dart path/workspace dependencies. If one package must publish before another, set `publish.pub.publishOrder` explicitly.

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

`version.pub.enabled` and `publish.pub.enabled` both default to `true`, so those keys are optional but make intent explicit. Set `publish.pub.enabled` to `false` to version and tag without publishing to pub.dev.

Configure authentication via OIDC or `PUB_TOKEN`. See [Auth](#auth) below.

---

## Quickstart — mixed npm + Dart monorepo

List npm and Dart package directories together in `version.packages`:

```json
{
  "$schema": "https://goosewobbler.github.io/releasekit/schema.json",
  "version": {
    "packages": ["packages/js-lib", "packages/cli", "packages/dart-core", "packages/flutter-widget"]
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

releasekit discovers a Dart package from its `pubspec.yaml`, within your `pnpm-workspace.yaml` globs if you have one. A `pubspec.yaml` beside a `package.json` is versioned with that package. With `version.pub.enabled: false` it's neither versioned nor published.

---

## Config reference

The Dart keys are [`version.pub`](./configuration.md#versionpub), [`publish.pub`](./configuration.md#publishpub) and [`publish.verify.pub`](./configuration.md#publishverifypub) in the configuration reference.

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
  pull-requests: write
  id-token: write # required for pub.dev OIDC automated publishing

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: dart-lang/setup-dart@v1

      # No pnpm/Node setup needed: the action sets up its own.
      - name: Run releasekit
        uses: goosewobbler/releasekit@v0
        with:
          mode: release
        # For token auth instead of OIDC, drop `id-token: write` above and add:
        # env:
        #   PUB_TOKEN: ${{ secrets.PUB_TOKEN }}
```

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
