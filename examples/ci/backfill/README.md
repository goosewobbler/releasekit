# backfill — regenerate notes for past releases

A maintainer dispatches this workflow to rebuild release notes for versions
that already have tags, from git history, and write them into the matching
GitHub Release bodies. Each run is a dry run unless `apply` is ticked, so you can
read what it would change in the log first.

## Files

| File | Copy to |
|------|---------|
| [`backfill.yml`](./backfill.yml) | `.github/workflows/backfill.yml` |
| [`releasekit.config.json`](./releasekit.config.json) | repo root |

## Running it

GitHub UI: Actions -> **Backfill Release Notes** -> Run workflow. Leave
`package` blank to backfill every workspace package; narrow with `from`/`to`.
CLI: `gh workflow run backfill.yml -f from=1.0.0 -f apply=true`.

## Assumptions

- `notes.releaseNotes` is enabled: backfill renders each body through it. `{}`
  gives the default notes; add `notes.releaseNotes.llm` and uncomment its key in
  the workflow for LLM-written ones.
- Tags look like `v1.2.3`. Backfill finds them through `version.versionPrefix`,
  so the config sets it to `v`; match it to your tags.
- Each version already has a GitHub Release. Backfill only edits releases; it
  skips a tag without one.
- `--only-missing` skips releases that already carry backfilled notes, so a
  re-run fills only new gaps. It rewrites every other body, hand-written ones
  included, so read the dry run before you tick `apply`. The other modes are in
  [`releasekit backfill`](../../../docs/cli.md#releasekit-release-backfill).

## Correctness notes

Shared [correctness rules](../../README.md#cross-cutting-correctness-rules) apply. Scenario-specific:

- `fetch-depth: 0` matters more than usual: backfill walks every tag, not just the latest.
- The dispatch inputs reach the shell through `env`, never inline `${{ inputs.* }}`, so a crafted value can't run as a command.
- `contents: write` is for `gh release edit`. Nothing is pushed.
