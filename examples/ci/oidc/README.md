# oidc — npm trusted publishing (no NPM_TOKEN)

Publish to npm with **OIDC trusted publishing**: the runner exchanges a
GitHub-issued OIDC token for a short-lived npm token at publish time, so there is
no long-lived `NPM_TOKEN` secret to manage. ReleaseKit detects OIDC
automatically; `publish.npm.auth: "oidc"` here forces it.

## Files

| File | Copy to |
|------|---------|
| [`release.yml`](./release.yml) | `.github/workflows/release.yml` |
| [`releasekit.config.json`](./releasekit.config.json) | repo root |

## Assumptions

- **npm >= 9.5.0.** Node 24 ships a recent enough npm, so `setup-node@v6` is
  fine as-is.
- Each package has a **trusted publisher** configured on npmjs.com (package
  Settings -> Trusted publishing -> add a GitHub Actions publisher for this repo
  **and this workflow filename**). The publisher is keyed to the top-level
  workflow file, so all OIDC publishes for a package must run from the same
  workflow file.
- `id-token: write` is granted (it is what mints the OIDC token).
- `provenance: true` attaches build provenance — supported on the public registry
  with OIDC.

## Correctness notes

OIDC-specific (the shared [correctness rules](../../README.md#cross-cutting-correctness-rules) apply too):

- **`id-token: write` is mandatory** — it's what mints the OIDC token.
- **Delete `.npmrc` before publishing.** `setup-node` with `registry-url` writes `_authToken=${NODE_AUTH_TOKEN}`; under OIDC that token is empty, so npm fails `ENEEDAUTH` instead of doing the OIDC exchange. `registry-url` still stays (it sets the cache + registry default — only the auth line is the problem).
