# release-preview — PR comment showing what would release

Every PR into `main` gets a comment listing the packages and versions that
would release if it merged. The comment is updated in place on each push or
label change, so a PR carries one preview comment however many times it runs.

## Files

| File | Copy to |
|------|---------|
| [`release-preview.yml`](./release-preview.yml) | `.github/workflows/release-preview.yml` |
| [`releasekit.config.json`](./releasekit.config.json) | repo root |

## Assumptions

- It runs alongside a release workflow such as [`minimal`](../minimal),
  [`label-driven`](../label-driven) or [`standing-pr`](../standing-pr), and
  shares its `releasekit.config.json`. The config here matches `minimal`; the
  preview follows whatever `ci.releaseStrategy` and `ci.releaseTrigger` say.
- `ci.prPreview` is on (the default). Set it to `false` to turn the comment off
  without removing the workflow.

## Correctness notes

Shared [correctness rules](../../README.md#cross-cutting-correctness-rules) apply. Scenario-specific:

- `concurrency` is per PR with `cancel-in-progress: true`: a newer push or label change supersedes the running preview.
- `pull-requests: write` is the only write scope the preview needs; it never pushes, tags or publishes.
- In standing-PR mode the preview skips the standing PR itself, whose manifest comment already shows the release.
