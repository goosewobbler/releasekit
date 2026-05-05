# ReleaseKit Architecture

A conceptual overview for contributors and users evaluating ReleaseKit.

---

## The three-stage pipeline

```
┌─────────────────────────────────────────────────┐
│                 releasekit release               │
│                                                  │
│  ┌─────────┐   ┌───────┐   ┌─────────────────┐  │
│  │ version ├──►│ notes ├──►│    publish      │  │
│  └─────────┘   └───────┘   └─────────────────┘  │
│      ↓             ↓               ↓             │
│  semver bump   changelog     git tag + npm       │
│  + VersionOutput  + release   + GitHub release   │
│                   notes       + crates.io        │
└─────────────────────────────────────────────────┘
```

**version** reads git history since the last tag, applies conventional commit rules, and computes the next semver for each package. It writes updated `package.json`/`Cargo.toml` files and emits a `VersionOutput` JSON object.

**notes** consumes `VersionOutput` and renders `CHANGELOG.md` and optional `RELEASE_NOTES.md` via Liquid/Handlebars/EJS templates. LLM enhancement is an optional pass inside this stage.

**publish** consumes the same `VersionOutput` and runs: git commit, git tag, `npm publish`, `cargo publish`, post-publish verification, git push, and GitHub Release creation — in that order.

### The `VersionOutput` shape

```json
{
  "dryRun": false,
  "updates": [
    { "packageName": "@scope/core", "newVersion": "1.2.3", "filePath": "/…/package.json" }
  ],
  "changelogs": [
    {
      "packageName": "@scope/core",
      "version": "1.2.3",
      "previousVersion": "v1.2.2",
      "revisionRange": "v1.2.2..HEAD",
      "repoUrl": "https://github.com/org/repo",
      "entries": [
        { "type": "added", "description": "New feature" },
        { "type": "fixed", "description": "Bug fix" }
      ]
    }
  ],
  "commitMessage": "chore: release v1.2.3",
  "tags": ["v1.2.3"]
}
```

`updates` is the list of packages that received a bump. Both `notes` and `publish` consume it directly; when using the programmatic API there is no JSON round-trip.

---

## Why three separate CLIs

Each package — `@releasekit/version`, `@releasekit/notes`, `@releasekit/publish` — is a standalone CLI that reads from stdin or a file and writes to stdout or disk. They can be piped together:

```
releasekit-version --json | releasekit-notes | releasekit-publish
```

`@releasekit/release` is orchestration sugar: it calls each tool's API directly (no subprocesses) and passes the typed `VersionOutput` through without serialising to JSON. A team that only wants changelog generation can install `@releasekit/notes` alone.

---

## What is "a release"

The atomic unit: a version bump + changelog entry + git commit + git tag + registry publish + GitHub Release. For monorepos this is per-package by default. Setting `version.sync: true` moves all packages to the same version. Each package can have its own tag template via `version.tagTemplate`.

---

## Tags as source of truth

Git tags mark what was last released. Conventional commits between the last tag and `HEAD` determine the next version bump. There are no version files to keep in sync — the tag *is* the current version baseline. This means:

- A shallow clone (`fetch-depth: 1`) will produce wrong results; always use `fetch-depth: 0`.
- Deleting or moving a tag manually changes what ReleaseKit sees as the baseline.
- `version.packageSpecificTags: true` creates per-package tags (e.g. `@scope/core@1.2.3`) instead of a single repo-wide tag.

---

## Release strategies

How and when releases are delivered. Configure under `ci.releaseStrategy`.

| Strategy | When to use |
|---|---|
| `direct` | Release on every merge to main (default) |
| `manual` | Human-triggered only (`workflow_dispatch`) |
| `standing-pr` | Changes accumulate in a bot-maintained release PR; merged when ready |
| `scheduled` | Periodic batching *(planned)* |

See [CI setup](../packages/release/docs/ci-setup.md) for full workflow YAML, prerequisites, and the standing-PR lifecycle.

---

## Release triggers

How the bump type is determined. Configure under `ci.releaseTrigger`.

**`commit`** — Conventional commits drive the bump automatically. Every merge can produce a release. Use the `release:skip` label to suppress a release on a specific PR.

**`label`** (default) — A PR label (`bump:patch`, `bump:minor`, or `bump:major`) must be present for a release to fire. The label controls the bump type. PRs without a release label are silently skipped, giving reviewers direct control over when and at what level a release ships.

Both modes support `bump:major` as an override and `channel:stable`/`channel:prerelease` as channel modifiers.

| | Commit trigger | Label trigger |
|---|---|---|
| Every merge can release | yes | no (needs bump label) |
| Reviewer controls bump type | no | yes |
| Skip a release | add `release:skip` label | omit bump label |
| Override to major | add `bump:major` label | add `bump:major` label |

---

## LLM enhancement

LLM processing is an optional pass inside the **notes** stage only. It never blocks publish on failure — if an LLM call errors, the pipeline logs a warning and continues with ungrouped output.

Available tasks:

| Task | What it does |
|---|---|
| `enhance` | Rewrites each entry description to be clearer |
| `summarize` | Generates a one-paragraph release summary |
| `categorize` | Groups entries into semantic categories (Breaking, New, Changed, Fixed, Developer) |
| `releaseNotes` | Generates full prose release notes for the GitHub Release body |

Supported providers: OpenAI, Anthropic, Ollama (local), and any OpenAI-compatible endpoint. All LLM config lives under `notes.releaseNotes.llm` in `releasekit.config.json`.

---

## Mixed monorepos

npm and Rust packages can coexist in a single repo under a single config. The version, notes, and publish stages are all package-manager aware:

- `version.cargo.paths` lists directories containing `Cargo.toml` files (auto-detected by default).
- `publish.cargo.enabled` must be set to `true` — it defaults to `false` to avoid accidental crates.io publishes.
- `publish.npm.enabled` defaults to `true`.

Each Rust crate appears as a named entry in `VersionOutput.updates` alongside npm packages; the publish pipeline runs `cargo publish` per-crate after npm.

---

## Idempotency guarantees

The publish stage is safe to retry after a partial failure:

- Packages already at the target version on the registry are skipped.
- Git tags that already exist are not recreated (the commit is still pushed if missing).
- GitHub Releases that already exist for a tag are not duplicated.

The pipeline is **fail-fast** within a single run: the first registry failure stops immediately and defers the git push, so the version commit and tag remain local until the issue is fixed and the command is retried.

---

## Mental model summary

Given the git tags, the commits since the last tag, and `releasekit.config.json`, ReleaseKit:

1. Computes the next semver for each package from conventional commits (or a forced `--bump`).
2. Writes updated manifest files and emits `VersionOutput`.
3. Renders changelogs and optional release notes from `VersionOutput`, optionally passing them through an LLM.
4. Creates a git commit and tags, pushes to the remote, publishes each package to npm and/or crates.io, verifies the publish, and creates a GitHub Release.

If the head commit message matches a skip pattern (default: `chore: release `), ReleaseKit exits early so that its own release commits do not trigger an infinite loop. If there are no releasable commits since the last tag, it exits with code 0 and skips all remaining steps.

---

## Further reading

- [docs/configuration.md](./configuration.md) — full config reference
- [CI setup](../packages/release/docs/ci-setup.md) — workflow YAML, label setup, OIDC, standing PR
- [@releasekit/version README](../packages/version/README.md) — versioning strategies, JSON output schema
- [@releasekit/notes README](../packages/notes/README.md) — changelog modes, templates, LLM tasks
- [@releasekit/publish README](../packages/publish/README.md) — npm/cargo/GitHub Release config
