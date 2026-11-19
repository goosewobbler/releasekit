# standing-pr — accumulate releases in a persistent PR

A single "standing" release PR (on `release/next`) accumulates version bumps and
release notes as commits land on `main`. Maintainers merge it when ready to ship;
merging publishes. A `release:retry` label re-runs a publish that failed partway.

Every job that writes runs on `main`, in a `release` environment restricted to
`main`. Events on the standing PR reach them through a relay that can only start
the workflow. One workflow file (`standing-pr.yml`) carries five jobs:

| Job | Fires on | Does |
|-----|----------|------|
| `relay` | a label change or checkbox edit on the open standing PR, or `release:retry` on the merged one | dispatches the workflow on `main`: an update, or a publish of that PR. Holds only `actions: write` |
| `detect` | push to `main` | reads the PR merged as the pushed commit, so only a standing-PR merge or a `release:immediate` PR starts `release` |
| `update` | push to `main`, hourly `schedule`, a dispatch without a PR | rebuilds `release/next` and the standing PR from the queued changes |
| `release` | the standing PR's merge, a merged `release:immediate` PR, a dispatch with a PR | publishes the merged standing PR still waiting for its tags (or the dispatched one), then for `release:immediate` releases directly, bypassing the standing PR |
| `reconcile` | `release` succeeding | rebuilds the standing PR now the release is tagged |

The jobs that write mint a GitHub App token when the App's secrets are in the
`release` environment, and use `GITHUB_TOKEN` otherwise. See
[The release environment](../../../packages/release/docs/ci-setup.md#the-release-environment)
and [The release App](../../../packages/release/docs/ci-setup.md#the-release-app-optional).

## Editing release notes before merge (optional)

By default the standing PR carries changelogs only; release notes are generated at publish time. To **review and edit** them first, label the standing PR **`release:preview-notes`**: the next `update` run generates LLM release notes into an editable, per-package region in the PR body (delimited by `<!-- releasekit-notes:<package> -->` markers). Edit the prose between the markers — your edits are preserved across update runs and win at merge.

Needs `notes.releaseNotes.llm` configured and the matching LLM secret uncommented on the `update` job (and on the publishing jobs, which generate the final notes). Standing-pr mode only — see [Previewing and editing release notes](../../../packages/release/docs/ci-setup.md#previewing-and-editing-release-notes).

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
  — this toggle is separate. It also lets any workflow token approve pull
  requests: see [Workflow token approvals](../../../packages/release/docs/ci-setup.md#workflow-token-approvals).
- **Environment (required):** a `release` environment whose deployment branches
  are restricted to `main`, with no required reviewers, holding the registry
  secrets (none with npm OIDC) and, optionally, the App's.
- `release/next` is **not** branch-protected (the bot force-pushes it), or the
  bot has bypass.
- Squash merge produces a single `chore: release ...` commit on `main`, which
  releasekit's skip pattern recognises so the merge doesn't trigger another
  update on itself.
- npm publishing via OIDC; swap to `NODE_AUTH_TOKEN`/`NPM_TOKEN` for token auth.

## Correctness notes

Shared [correctness rules](../../README.md#cross-cutting-correctness-rules) apply (each job lists its own `permissions`; only `release` adds `id-token: write`). Scenario-specific:

- `release` and `reconcile` start from the push of the merge to `main`, not from `pull_request: closed`, so the `release` environment's secrets never reach a run on another ref.
- Only another release run can replace a queued `release`. A push's run publishes whatever standing release is still untagged; a retry's publishes only its PR. Updates and `reconcile` share a group of their own; a checkbox edit cancels the update in progress.
- The relayed `release:retry` publishes on `main` with `--pr`, then removes the label so each application is exactly one retry.
