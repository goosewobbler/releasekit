# minimal — push-to-main direct release

The simplest setup: every push to `main` runs `releasekit release`. Bumps are
derived from Conventional Commits since the last tag; if nothing is releasable
the command exits 0 and the workflow is a no-op.

## Files

| File | Copy to |
|------|---------|
| [`release.yml`](./release.yml) | `.github/workflows/release.yml` |
| [`releasekit.config.json`](./releasekit.config.json) | repo root |

## Assumptions

- The default branch is `main`.
- Releases are driven by commits (`ci.releaseTrigger: "commit"`), not labels —
  every push that contains a `feat:`/`fix:`/etc. commit since the last tag
  releases. To require a `bump:*` label instead, see [`label-driven`](../label-driven).
- npm publishing via OIDC (no `NPM_TOKEN`); see [`oidc`](../oidc) to switch to token auth.

The workflow follows the [correctness rules](../../README.md#cross-cutting-correctness-rules) every example shares; its inline comments cover the per-step reasoning.
