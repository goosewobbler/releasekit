# backfill — regenerate notes for past releases

A maintainer dispatches this workflow to rebuild release notes for
already-tagged versions from git history and write them into their GitHub
Release bodies. Runs are dry runs unless `apply` is ticked, so you can check the
log first.

## Files

| File | Copy to |
|------|---------|
| [`backfill.yml`](./backfill.yml) | `.github/workflows/backfill.yml` |
| [`releasekit.config.json`](./releasekit.config.json) | merge `version.versionPrefix` and `notes.releaseNotes` into yours |

## Running it

GitHub UI: Actions -> **Backfill Release Notes** -> Run workflow. Leave
`path` blank to backfill every workspace package, or give one package's
directory (`packages/core`). Narrow with `from`/`to`.
CLI: `gh workflow run backfill.yml -f from=1.0.0 -f apply=true`.

## Assumptions

- `notes.releaseNotes` is enabled: backfill renders each body through it. `{}`
  gives the default notes; add `notes.releaseNotes.llm` and uncomment its key in
  the workflow for LLM-written ones.
- Tags look like `v1.2.3`. Backfill finds them through `version.versionPrefix`,
  so the config sets it to `v`; match it to your tags.
- With one shared tag series (no package-specific tags), a blank `path` makes
  every package write to the same releases and the last one wins, so give a
  `path`.
- Each version already has a GitHub Release; backfill skips a tag without one.
- Backfill fills empty release bodies and rewrites the ones it wrote before. It
  leaves every other body, including notes releasekit published, unless you
  tick `force`. Flags are in
  [`releasekit backfill`](../../../docs/cli.md#releasekit-release-backfill).

## Correctness notes

Shared [correctness rules](../../README.md#cross-cutting-correctness-rules) apply. Scenario-specific:

- `fetch-depth: 0` matters more than usual: backfill walks every tag, not just the latest.
- The dispatch inputs reach the shell through `env`, never inline `${{ inputs.* }}`, so a crafted value can't run as a command.
- `contents: write` is for `gh release edit`, and `pull-requests: read` lets LLM notes read each PR. Nothing is pushed.
