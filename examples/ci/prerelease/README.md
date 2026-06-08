# prerelease — manual prerelease dispatch

A maintainer manually dispatches this workflow and chooses a prerelease
identifier (`beta`, `rc`, ...). releasekit produces versions like `1.4.0-beta.0`
and publishes them under a non-`latest` npm dist-tag so they don't become the
default install.

## Files

| File | Copy to |
|------|---------|
| [`prerelease.yml`](./prerelease.yml) | `.github/workflows/prerelease.yml` |
| [`releasekit.config.json`](./releasekit.config.json) | repo root |

## Running it

GitHub UI: Actions -> **Prerelease** -> Run workflow -> set the identifier.
CLI: `gh workflow run prerelease.yml -f identifier=rc`.

## Assumptions

- Prereleases are deliberate, maintainer-triggered events, hence
  `workflow_dispatch` and `ci.releaseStrategy: "manual"` (no push/merge auto-fires
  this).
- `publish.npm.tag: "next"` keeps prereleases off the `latest` dist-tag —
  consumers opt in with `npm install pkg@next`. Change to match your channel.
- `version.prereleaseIdentifier` sets the default identifier; the workflow input
  overrides it per run via `--prerelease`.
- npm publishing via OIDC; swap to `NODE_AUTH_TOKEN`/`NPM_TOKEN` for token auth.

## Correctness notes

- **pnpm before setup-node** (hosted runners lack pnpm).
- **`fetch-depth: 0`** for full history.
- The workflow input `identifier` is interpolated into `--prerelease
  ${{ inputs.identifier }}`. The dispatch input is constrained by its `default`
  in the UI; treat dispatch inputs as trusted-maintainer-only.
