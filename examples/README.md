# ReleaseKit examples

Runnable, validated CI scenarios. Each scenario is a self-contained directory:
a workflow file (header comment says where to copy it), a minimal
`releasekit.config.json`, and a README stating the scenario's assumptions.

These files are the **single validated source of truth** for CI usage. They are
checked in CI on every change (see [`Validation`](#validation) below), so unlike
markdown snippets they cannot rot silently.

## CI scenarios

| Scenario | What it shows |
|----------|---------------|
| [`ci/minimal`](./ci/minimal) | Push-to-main direct release driven by Conventional Commits. |
| [`ci/label-driven`](./ci/label-driven) | Release only when a merged PR carries a `bump:*` label (trigger + gate). |
| [`ci/standing-pr`](./ci/standing-pr) | Standing release PR: `update` + `publish` + `retry-publish` jobs. |
| [`ci/oidc`](./ci/oidc) | npm OIDC trusted publishing — no `NPM_TOKEN`. |
| [`ci/monorepo-rust`](./ci/monorepo-rust) | Mixed npm + Cargo monorepo (npm OIDC + crates.io token). |
| [`ci/prerelease`](./ci/prerelease) | Manual `workflow_dispatch` prerelease with a chosen identifier. |

## Cross-cutting correctness rules

Every workflow here follows these rules — they are the ones most often gotten
wrong in hand-written workflows:

- **Set up pnpm before `actions/setup-node`.** Hosted GitHub runners do **not**
  ship pnpm. Add `pnpm/action-setup@v5` *before* `actions/setup-node`, so that
  `setup-node`'s `cache: pnpm` can find the binary. Omitting this is the single
  most common failure — and `actionlint` will **not** catch it (see below).
- **Node 24** in `actions/setup-node`.
- **`fetch-depth: 0`** on `actions/checkout` — releasekit walks full git history
  to compute the bump.
- **Explicit `permissions:` blocks are zero-by-default.** Naming any scope
  removes every scope you didn't name, so each workflow lists exactly what its
  jobs need (e.g. `contents: write` for tags/releases, `id-token: write` for OIDC).
- **OIDC needs `.npmrc` removed.** `setup-node` with `registry-url` writes an
  `.npmrc` with `_authToken=${NODE_AUTH_TOKEN}`; with OIDC that token is empty
  and npm fails `ENEEDAUTH`. The OIDC-publishing examples `rm -f .npmrc` first.

## Validation

`.github/workflows/examples-validate.yml` runs on every change under `examples/`:

1. **`actionlint`** over `examples/**/*.yml` — catches workflow syntax errors,
   bad `uses:` refs, invalid `if:` expressions, unknown contexts, shellcheck
   findings in `run:` steps.
2. **JSON Schema validation** of every `examples/**/releasekit.config.json`
   against the repo's `releasekit.schema.json` (via `ajv-cli`). Because the
   schema is `additionalProperties: false`, a typo'd or removed config key fails
   the build.

> **What validation does NOT catch.** `actionlint` is a static linter: it has no
> model of what tools a hosted runner ships. A workflow that calls `pnpm` but
> never runs `pnpm/action-setup` is **syntactically valid** and lints clean — it
> only fails at runtime with `pnpm: command not found`. The same is true for a
> missing `dtolnay/rust-toolchain` before `cargo`. Catching those requires an
> **execution smoke-test** (actually running the workflow on a runner), which is
> recommended as a follow-up. See issue #263 (the existing docs templates ship
> exactly this missing-pnpm bug) and issue #259.
