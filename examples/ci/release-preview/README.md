# release-preview — PR comment showing what would release

Each PR into `main` gets a comment listing the packages and versions that would
release if it merged, updated in place on each push or label change.

## Files

| File | Copy to |
|------|---------|
| [`release-preview.yml`](./release-preview.yml) | `.github/workflows/release-preview.yml` |
| [`releasekit.config.json`](./releasekit.config.json) | repo root, unless your release workflow already has one |

## Assumptions

- It runs alongside a release workflow such as [`minimal`](../minimal),
  [`label-driven`](../label-driven) or [`standing-pr`](../standing-pr), and
  shares its `releasekit.config.json`. The config here matches `minimal`; the
  preview follows whatever `ci.releaseStrategy` and `ci.releaseTrigger` say.
- `ci.prPreview` is on (the default).

## Correctness notes

Shared [correctness rules](../../README.md#cross-cutting-correctness-rules) apply. Scenario-specific:

- `concurrency` is per PR with `cancel-in-progress: true`: a newer push or label change supersedes the running preview.
- `pull-requests: write` is the only write scope the preview needs; it never pushes, tags or publishes.
- The job skips fork PRs, whose read-only token can't post the comment, and the standing PR, whose manifest comment already shows the release.
