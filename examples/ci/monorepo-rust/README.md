# monorepo-rust — mixed npm + Cargo release

One config releases both npm packages and Rust crates. npm publishes via OIDC
trusted publishing; crates.io has no OIDC, so it uses a `CARGO_REGISTRY_TOKEN`
secret. Crates are published in topological (path-dependency) order
automatically.

## Files

| File | Copy to |
|------|---------|
| [`release.yml`](./release.yml) | `.github/workflows/release.yml` |
| [`releasekit.config.json`](./releasekit.config.json) | repo root |

## Assumptions

- Layout: npm packages under `packages/*` (listed in `version.packages`), Rust
  crates under `crates/*` (listed in `version.cargo.paths`). Adjust both lists
  to your repo. If your crates sit alongside the `version.packages` directories,
  `version.cargo.paths` can be omitted and releasekit infers them from adjacent
  `Cargo.toml` files.
- `publish.cargo.enabled` is **`true`** explicitly — it defaults to `false`, so
  nothing reaches crates.io unless you opt in.
- Secrets: `CARGO_REGISTRY_TOKEN` (crates.io API token with publish scopes) is
  set in repo Actions secrets. npm needs no secret thanks to OIDC.
- npm packages have trusted publishers configured on npmjs.com (see
  [`oidc`](../oidc)).

## Correctness notes

- **Two runtimes to install.** Hosted runners ship neither pnpm nor the Rust
  toolchain. `pnpm/action-setup@v5` (before setup-node) handles pnpm;
  `dtolnay/rust-toolchain@stable` provides `cargo`. Omitting the latter yields
  `cargo: command not found` at the publish stage.
- **Delete `.npmrc`** before publishing so npm OIDC isn't shadowed by an empty
  token (see [`oidc`](../oidc) for why).
- **`fetch-depth: 0`** for full history.
- crates.io index propagation is slower than npm; releasekit polls after each
  publish (configurable under `publish.verify.cargo`) and skips already-published
  versions, so re-running a partially failed release is safe.
