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

Two workflows guard these examples on every change under `examples/`:

`.github/workflows/examples-validate.yml` (static):

1. **`actionlint`** over `examples/**/*.yml` — catches workflow syntax errors,
   bad `uses:` refs, invalid `if:` expressions, unknown contexts, shellcheck
   findings in `run:` steps.
2. **JSON Schema validation** of every `examples/**/releasekit.config.json`
   against the repo's `releasekit.schema.json` (via `ajv-cli`). Because the
   schema is `additionalProperties: false`, a typo'd or removed config key fails
   the build.
3. **Smoke-workflow drift guard** — regenerates `examples-smoke.yml` from the
   examples and fails if it differs, so the smoke test below can never fall out
   of sync with the steps it runs.

`.github/workflows/examples-smoke.yml` (execution):

4. **Execution smoke-test** — for each scenario, runs that example's **real
   setup steps** (extracted from the example workflow, not hand-copied) on a
   hosted `ubuntu-latest` runner against a throwaway fixture repo, then a
   `releasekit release --dry-run`. This catches the missing-runtime-tool class
   and install failures (`pnpm`/`cargo: command not found`, wrong Node version,
   `cache: pnpm` with no lockfile, `pnpm install` errors, the CLI not
   resolving). Publish never runs for real — every release is `--dry-run`.

> **What validation does NOT catch.** `actionlint` is a static linter: it has no
> model of what tools a hosted runner ships, so a missing `pnpm/action-setup` or
> `dtolnay/rust-toolchain` lints clean and would only fail at runtime. The
> **execution smoke-test** (`examples-smoke.yml`) exists alongside it precisely
> to close that gap — it runs each example's setup + a dry-run release on a real
> runner. What stays uncaught is everything the dry run deliberately skips:
> **real publishing and the npm OIDC exchange** (publish runs as `--dry-run`, so
> trusted-publisher setup and token scopes are unverified); **event-trigger
> semantics** (the smoke test invokes the *steps*, not the `pull_request` /
> `schedule` / `workflow_dispatch` *events*, so guards like the standing-PR
> `action == 'closed'` check aren't exercised); and **secret- or
> permission-gated, API-mutating paths** (creating/merging PRs, force-pushing
> `release/next`). Verifying those requires a real release in a real repo. See
> issue #276 (this smoke-test), and #259 / #263 for the static layer and the
> missing-pnpm class it could not catch.
