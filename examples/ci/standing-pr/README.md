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

## Editing release notes before merge (optional)

By default the standing PR carries changelogs only; release notes are generated at publish time. To **review and edit** them first, label the standing PR **`release:preview-notes`**: the next `update` run generates LLM release notes into an editable, per-package region in the PR body (delimited by `<!-- releasekit-notes:<package> -->` markers). Edit the prose between the markers — your edits are preserved across update runs and win at merge.

Needs `notes.releaseNotes.llm` configured and the matching LLM secret uncommented on the `update` job. Standing-pr mode only — see [Previewing and editing release notes](../../../packages/release/docs/ci-setup.md#previewing-and-editing-release-notes).

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

Shared [correctness rules](../../README.md#cross-cutting-correctness-rules) apply (the `permissions` block lists all four scopes the three jobs need). Scenario-specific:

- The `pull_request` trigger subscribes to **both** `closed` and `labeled`. The `publish` job guards on `action == 'closed'` so a label on an already-merged PR can't re-trigger a publish; only `retry-publish` reacts to `labeled`.
- `retry-publish` checks out `ref: main` (since `release/next` is deleted on merge), then removes the `release:retry` label so each application is exactly one retry.
