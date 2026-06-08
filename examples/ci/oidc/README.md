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

- **`id-token: write` is mandatory.** Without it there is no OIDC token and the
  publish falls back to needing a token it doesn't have.
- **Delete `.npmrc` before publishing.** `actions/setup-node` with `registry-url`
  writes a project `.npmrc` containing `_authToken=${NODE_AUTH_TOKEN}`. With OIDC
  there is no `NODE_AUTH_TOKEN`, so npm resolves it to an **empty** token and
  fails with `ENEEDAUTH` instead of performing the OIDC exchange. The
  `rm -f .npmrc` step removes it. (We still pass `registry-url` so pnpm's cache
  and the registry default are set; only the auth line is the problem.)
- **pnpm before setup-node** (hosted runners lack pnpm).
- **`fetch-depth: 0`** for full history.
