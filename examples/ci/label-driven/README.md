# label-driven — `bump:*` label trigger + gate

A release fires only when a PR is **merged with a `bump:*` label**. Conventional
commits still produce the changelog entries; the label decides whether to
release and at what magnitude.

| Label on the merged PR | Result (from `1.2.3`) |
|------------------------|-----------------------|
| `bump:patch` | `1.2.4` |
| `bump:minor` | `1.3.0` |
| `bump:major` | `2.0.0` |
| `release:skip` | no release |
| _(none)_ | no release |

## Files

| File | Copy to |
|------|---------|
| [`release.yml`](./release.yml) | `.github/workflows/release.yml` |
| [`releasekit.config.json`](./releasekit.config.json) | repo root |

## Assumptions

- The default branch is `main` and PRs are merged into it.
- The repo has the labels `bump:patch`, `bump:minor`, `bump:major` (and
  optionally `release:skip`). These match releasekit's defaults; the `labels`
  block in the config is shown for clarity and can be omitted if you keep the
  defaults.
- npm publishing via OIDC. Swap to `NODE_AUTH_TOKEN`/`NPM_TOKEN` if you prefer
  token auth (see [`oidc`](../oidc)).

## How the gate works

There are **two** gates, and they must agree:

1. **Workflow `if:`** — a coarse guard that the merged PR carries one of the
   `bump:*` labels. Workflow expressions cannot read `releasekit.config.json`,
   so the label names here are **hardcoded** to the defaults. If you rename a
   label via `ci.labels.*`, update this `if:` to match.
2. **`releasekit release`** — re-reads `ci.labels` from config and is the
   authoritative decision. The workflow gate is just there to avoid spinning up
   a runner for PRs that obviously won't release.

## Correctness notes

- **pnpm before setup-node** (hosted runners lack pnpm).
- **`fetch-depth: 0`** for full history.
- The `permissions` block lists `pull-requests: read` because the gate inspects
  the merged PR's labels; `contents: write` and `id-token: write` are for
  tagging/releases and OIDC respectively.
- Trigger is `pull_request: [closed]` (not `push`), because the label lives on
  the PR. The `merged == true` check excludes PRs that were closed without
  merging.
