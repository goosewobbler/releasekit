# release-preview — PR comment showing what would release

Every PR into `main` from a branch in the repo gets a comment listing the
packages and versions that would release if it merged. The comment is updated in place on each push or
label change, so a PR carries one preview comment however many times it runs.

## Files

| File | Copy to |
|------|---------|
| [`release-preview.yml`](./release-preview.yml) | `.github/workflows/release-preview.yml` |
| [`releasekit.config.json`](./releasekit.config.json) | not needed: the preview uses your release workflow's config |

## Assumptions

- It runs alongside a release workflow such as [`minimal`](../minimal),
  [`label-driven`](../label-driven) or [`standing-pr`](../standing-pr), and
  shares its `releasekit.config.json`. The config here matches `minimal`; the
  preview follows whatever `ci.releaseStrategy` and `ci.releaseTrigger` say.
- `ci.prPreview` is on (the default). Setting it to `false` turns the comment
  off, but the job still runs on each PR event until you remove the workflow.

## Correctness notes

Shared [correctness rules](../../README.md#cross-cutting-correctness-rules) apply. Scenario-specific:

- `concurrency` is per PR with `cancel-in-progress: true`: a newer push or label change supersedes the running preview.
- `pull-requests: write` is the only write scope the preview needs; it never pushes, tags or publishes.
- The job skips fork PRs, whose read-only token can't post the comment, and the standing PR, whose manifest comment already shows the release. The `release/next` name is hardcoded: update it if you change `ci.standingPr.branch`.
