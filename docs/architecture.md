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

**notes** consumes `VersionOutput` and renders the `CHANGELOG.md` plus per-release notes (the GitHub release body, or optional per-version files) via Liquid/Handlebars/EJS templates. LLM enhancement is an optional pass inside this stage.

**publish** consumes the same `VersionOutput`. It prepares files, creates the commit and tags locally, publishes to npm, crates.io, and pub.dev, then pushes and creates GitHub Releases. The order depends on the mode — see [Publish order and partial failure](#publish-order-and-partial-failure).

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

Each package — `@releasekit/version`, `@releasekit/notes`, `@releasekit/publish` — is a standalone CLI that reads from stdin or a file and writes to stdout or disk. They chain through a `VersionOutput` file; see [Chaining `version`, `notes`, and `publish`](./cli.md#chaining-version-notes-and-publish).

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

### Pre-1.0 breaking changes

Pre-1.0 (current major `0`), a commit-inferred breaking change bumps the 0.x minor (`0.24.0 → 0.25.0`), not `1.0.0` — it never auto-graduates the project to a stable API. To cut `1.0.0` deliberately, use an explicit `bump:major` (or `--bump major`); see [`version.zeroMajor`](configuration.md#versionzeromajor) for the rule and the `strict` opt-out.

---

## Release strategies

How and when releases are delivered. Configure under `ci.releaseStrategy`.

| Strategy | When to use |
|---|---|
| `direct` | Release on every merge to main (default) |
| `manual` | Human-triggered only (`workflow_dispatch`) |
| `standing-pr` | Changes accumulate in a bot-maintained release PR; merged when ready |

See [CI setup](../packages/release/docs/ci-setup.md) for full workflow YAML, prerequisites, and the standing-PR lifecycle.

---

## Release triggers

How the bump type is determined. Configure under `ci.releaseTrigger`.

**`commit`** — Conventional commits drive the bump automatically. Every merge can produce a release. Use the `release:skip` label to suppress a release on a specific PR.

**`label`** (default) — A PR label (`bump:patch`, `bump:minor`, or `bump:major`) must be present for a release to fire. The label controls the bump type. PRs without a release label are silently skipped, giving reviewers direct control over when and at what level a release ships.

Both modes support `bump:major` as an override, `channel:prerelease` as a channel modifier, and `release:graduate` to graduate a prerelease to its stable base version. In standing-PR mode a `graduate:<package>` label graduates a single prerelease package (and, atomically, any `fixed`/`linked` group it belongs to) while the rest stay on their own line.

| | Commit trigger | Label trigger |
|---|---|---|
| Every merge can release | yes | no (needs bump label) |
| Reviewer controls bump type | no | yes |
| Skip a release | add `release:skip` label | omit bump label |
| Override to major | add `bump:major` label | add `bump:major` label |

> **In standing-pr strategy, label semantics differ.** Feeder PR labels (`bump:*`, `scope:*`, `channel:*`) are advisory — they're rendered in the preview but don't drive behavior on merge. The standing PR itself is the canonical override surface: add `bump:major` etc. to the standing PR to drive the next release. To bypass the queue and ship a single PR directly, label it `release:immediate`. See [CI setup → Label semantics in standing-pr mode](../packages/release/docs/ci-setup.md#label-semantics-in-standing-pr-mode).

### Coordinating multiple packages

Past "everything moves together," ReleaseKit separates three concerns: **explicit groups** (declared coupling), **derived prerequisites** (changed transitive dependencies, pulled in on demand), and **selection** (which packages to release now — scope labels, CLI targets, or standing-PR checkboxes). They're orthogonal and compose. See the [release taxonomy](./release-taxonomy.md) for when to use each, with worked examples from real consumer repos.

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
- `publish.npm.enabled` and `publish.cargo.enabled` both default to `true`; set either to `false` to version and tag without publishing ([ADR-0004](./adr/0004-ecosystem-enablement-detection-enables-config-opts-out.md)).

Each Rust crate appears as a named entry in `VersionOutput.updates` alongside npm packages. Within a publish step the registries run in order: npm, then crates.io, then pub.dev.

---

## Publish order and partial failure

Direct `release` computes versions in memory, then runs the scope, skip-pattern, and minimum-change guards. It writes manifests, then changelogs, and only then starts publish.

Publish always prepares first (copy files, rewrite `Cargo.toml`, sync `Cargo.lock`) and creates the release commit and **every tag locally, before any registry publish**. In standing-PR mode the squash merge already put that commit on the remote, so publish only creates tags.

The run is **fail-fast**: the first registry failure stops the pipeline.

**Batch mode** — no update carries its own `tag` (sync with one shared tag):

1. Publish npm, then crates.io, then pub.dev.
2. Verify. Verification only warns.
3. Only if every publish succeeded: push the branch, then the tags, then create GitHub Releases.

Nothing is pushed on failure. In direct mode the version bump is **not** on `main`. Packages that already published stay on the registry. Re-run; those versions are skipped. Do not delete a tag for a version that was published.

**Per-package mode** — any update has a `tag` (single, async, groups, or sync with `packageSpecificTags`):

For each update: publish that package (npm, then crates.io, then pub.dev) → verify → push the branch → push its tag. GitHub Releases are created only after every package succeeds.

On failure, earlier packages' tags **and the release commit are already on the remote**, and no package has a GitHub Release. Do not delete those tags. Roll forward with the next release.

**Standing-PR mode** uses the same batch or per-package publish, but the version commit is already on `main` from the merge. Recover with the `release:retry` label on the merged standing PR (or `standing-pr publish --pr`). Do not delete a tag whose version was published.

Already-published versions are skipped on a later run. A local tag that points at the current commit is not recreated, and an existing GitHub Release for a tag is not duplicated. A retry never reverts a commit or deletes a tag.

---

## Mental model summary

Given the git tags, the commits since the last tag, and `releasekit.config.json`, ReleaseKit:

1. Computes the next semver for each package from conventional commits (or a forced `--bump`).
2. Writes updated manifest files and emits `VersionOutput`.
3. Renders changelogs and optional release notes from `VersionOutput`, optionally passing them through an LLM.
4. Publishes, then pushes and creates GitHub Releases, in the order in [Publish order and partial failure](#publish-order-and-partial-failure). Tags are created locally before publishing and pushed only after a clean publish (once, at the end, in batch mode; after each package in per-package mode).

If the head commit message matches a skip pattern (default: `chore: release `), ReleaseKit exits early so that its own release commits do not trigger an infinite loop. If there are no releasable commits since the last tag, it exits with code 0 and skips all remaining steps.

---

## Further reading

- [docs/configuration.md](./configuration.md) — full config reference
- [CI setup](../packages/release/docs/ci-setup.md) — workflow YAML, label setup, OIDC, standing PR
- [@releasekit/version README](../packages/version/README.md) — versioning strategies, JSON output schema
- [@releasekit/notes README](../packages/notes/README.md) — changelog modes, templates, LLM tasks
- [@releasekit/publish README](../packages/publish/README.md) — npm/cargo/GitHub Release config
