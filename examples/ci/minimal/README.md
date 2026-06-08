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
- npm publishing is enabled. The example uses **npm OIDC trusted publishing**
  (`id-token: write` + no `NPM_TOKEN`). To publish with a token instead, drop
  `id-token: write`, set `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`, and see
  [`oidc`](../oidc) for the OIDC details.

## Correctness notes

- **pnpm is installed before setup-node.** Hosted GitHub runners do not ship
  pnpm; `pnpm/action-setup@v5` must run first, and before `actions/setup-node`
  so that `cache: pnpm` can locate the binary. Omitting it is the single most
  common mistake (see the validation note in [`../README.md`](../README.md)).
- **`fetch-depth: 0`** gives releasekit the full git history it needs to compute
  the bump.
- **The `permissions` block is explicit.** Declaring any scope zeroes all the
  others, so `contents: write` is listed even though the default token has it.
- **`.npmrc` is removed before publishing under OIDC.** `actions/setup-node`
  with `registry-url` writes a `.npmrc` containing
  `_authToken=${NODE_AUTH_TOKEN}`; with OIDC that variable is empty, so npm
  exits `ENEEDAUTH` instead of performing the OIDC exchange. Drop the
  `rm -f .npmrc` step if you switch to `NODE_AUTH_TOKEN`/token auth.
