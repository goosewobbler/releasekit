# standing-pr — accumulate releases in a persistent PR

A single "standing" release PR (on `release/next`) accumulates version bumps and
release notes as commits land on `main`. Maintainers merge it when ready to ship;
merging publishes. A `release:retry` label re-runs a publish that failed partway.

One workflow file (`standing-pr.yml`) carries three jobs:

| Job | Fires on | Does |
|-----|----------|------|
| `update` | push to `main`, hourly `schedule` | rebuilds `release/next` and the standing PR from the queued changes |
| `publish` | the standing PR being **merged** | publishes the reviewed manifest, tags, GitHub Releases |
| `retry-publish` | `release:retry` label on the **merged** standing PR | idempotently re-publishes whatever the failed run left unfinished |

## Files

| File | Copy to |
|------|---------|
| [`standing-pr.yml`](./standing-pr.yml) | `.github/workflows/standing-pr.yml` |
| [`releasekit.config.json`](./releasekit.config.json) | repo root |

## Assumptions

- **Repo setting (required):** Settings -> Actions -> General -> Workflow
  permissions -> enable **"Allow GitHub Actions to create and approve pull
  requests"**. Without it the first `update` run fails with HTTP 403. The
  `pull-requests: write` workflow permission is necessary but **not** sufficient
  — this toggle is separate.
- `release/next` is **not** branch-protected (the bot force-pushes it), or the
  bot has bypass.
- Squash merge produces a single `chore: release ...` commit on `main`, which
  releasekit's skip pattern recognises so the merge doesn't trigger another
  update on itself.
- npm publishing via OIDC; swap to `NODE_AUTH_TOKEN`/`NPM_TOKEN` for token auth.

## Correctness notes

- **pnpm before setup-node** in every job (hosted runners lack pnpm).
- **`fetch-depth: 0`** everywhere — releasekit walks full history.
- The `permissions` block lists all four scopes the jobs need
  (`contents`/`pull-requests`/`id-token`/`statuses`); an explicit block zeroes
  anything unlisted.
- The `pull_request` trigger subscribes to **both** `closed` and `labeled`. The
  `publish` job guards on `action == 'closed'` so that a label added to an
  already-merged PR can't re-trigger a publish; only `retry-publish` reacts to
  `labeled`.
- `retry-publish` checks out `ref: main` because `release/next` is deleted on
  merge, then removes the `release:retry` label so each application is exactly
  one retry.
