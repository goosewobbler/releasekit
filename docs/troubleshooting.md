# Troubleshooting

Each section below covers a specific failure mode. Search for the exact message text you see in your logs to find the relevant entry.

---

## Version stage

### No new commits found for X since tag Y, skipping version bump

**Symptom:** The version stage logs `No new commits found for <package> since tag <tag>, skipping version bump` and exits with code 0.

**Cause:** There are commits since the tag, but none qualify as releasable under the configured preset. The default `conventionalcommits` preset treats only `feat:`, `fix:`, and `BREAKING CHANGE` as releasable. Commits with types like `chore:`, `docs:`, `refactor:`, `test:`, and `ci:` are not releasable.

**Fix:** Either (a) add a releasable commit (`feat:` or `fix:`), (b) force a bump with `--bump patch`, or (c) extend the preset's `releasableTypes` in config if your project treats additional types as releasable. Confirm which commits exist with `git log <tag>..HEAD --oneline`.

---

### Discovered 0 NPM packages and 0 Rust packages

**Symptom:** The version stage logs `Discovered 0 NPM packages and 0 Rust packages` and does nothing.

**Cause:** `version.packages` is set to a pattern that matches no packages, or the path is wrong. This can also occur in a non-monorepo project where workspace discovery fails because `package.json` is missing a `workspaces` field.

**Fix:** Check `version.packages` in `releasekit.config.json`. The value should be an array of glob patterns matching package name strings (e.g. `["@myorg/*"]`) or workspace-relative paths. Run with `--verbose` to see what directories are scanned. For single-package repos, omit `version.packages` entirely and let auto-detection run.

---

### mismatchStrategy: package.json version (X) differs from tag (Y)

**Symptom:** The version stage logs a mismatch warning between the `package.json` version and the latest git tag and either aborts or continues unexpectedly.

**Cause:** The version written to `package.json` has diverged from the version encoded in the latest git tag. This typically happens after a manual version bump, a partial release, or cherry-picking a version commit without its accompanying tag.

**Fix:** The `version.mismatchStrategy` config option controls behaviour:

| Strategy | Behaviour |
|----------|-----------|
| `warn` (default) | Log a warning and continue using the git tag |
| `error` | Abort with a non-zero exit code |
| `prefer-git` | Silently trust the git tag; ignore `package.json` |
| `prefer-package` | Silently trust `package.json`; ignore the tag |
| `ignore` | Suppress the warning and continue |

Set the appropriate strategy in `releasekit.config.json` under `version.mismatchStrategy`. If you want to resync permanently, align `package.json` and the tag manually, then re-run.

---

### Branch pattern matched but no defaultReleaseType set

**Symptom:** The version stage logs that a branch pattern matched but no `defaultReleaseType` is set, and no version bump is applied.

**Cause:** `version.branchPatterns` contains an entry whose pattern matches the current branch, but the entry is missing a `defaultReleaseType` field. Without it, the stage cannot determine a bump level from the branch name alone.

**Fix:** Add `defaultReleaseType` to the matching `branchPatterns` entry:

```json
{
  "version": {
    "branchPatterns": [
      { "pattern": "feature/*", "defaultReleaseType": "minor" },
      { "pattern": "fix/*",     "defaultReleaseType": "patch" }
    ]
  }
}
```

---

## Notes stage

### LLM API key is not set. Returning entries ungrouped.

**Symptom:** The notes stage logs `OLLAMA_API_KEY is not set. Returning entries ungrouped.` (or the equivalent for `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`). Release notes are generated but LLM categorisation and enhancement are skipped.

**Cause:** The API key environment variable for the configured LLM provider is not present in the workflow environment. This is treated as a soft failure — notes are generated without LLM enhancement rather than aborting the release.

**Fix:** Pass the secret to the job that runs the notes stage. For the standing-PR workflow, add it to the `update-release-pr` job's `env:` block:

```yaml
- run: pnpm exec releasekit standing-pr update
  env:
    GITHUB_TOKEN: ${{ github.token }}
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    # or ANTHROPIC_API_KEY / OLLAMA_API_KEY depending on notes.releaseNotes.llm.provider
```

See [ci-setup.md — Standing Release PR](../packages/release/docs/ci-setup.md#standing-release-pr) for the full workflow snippet and the secrets table.

---

### LLM provider request timed out

**Symptom:** The notes stage throws `LLM provider request timed out` or a similar deadline-exceeded error.

**Cause:** The LLM API did not respond within `notes.releaseNotes.llm.options.timeout` (default 60 000 ms). Large releases with many entries or slow provider endpoints are common triggers.

**Fix:** Increase the timeout in config:

```json
{
  "notes": {
    "releaseNotes": {
      "llm": {
        "options": { "timeout": 120000 }
      }
    }
  }
}
```

Also consider reducing `llm.concurrency` (default `5`) if the provider rate-limits concurrent requests, or switching to a faster model for the initial categorise pass.

---

### Categories defined but no commits matched any category

**Symptom:** The notes stage completes without error, but the generated release notes contain no categorised entries, or all entries fall into an uncategorised bucket.

**Cause:** The LLM returned categories that do not match any entry in the commit list. This usually means the custom `categories` descriptions are too restrictive, use domain-specific terminology the model does not map to the commits, or the commit messages themselves are not descriptive enough.

**Fix:** Broaden the `description` fields in `notes.releaseNotes.llm.categories`, or remove the `categories` override entirely to use the built-in defaults (`Breaking`, `New`, `Changed`, `Fixed`, `Developer`). Run with `--verbose` to inspect the raw LLM response and see what categories were returned. You can also add `prompts.instructions.categorize` to guide the model more explicitly.

---

### Template not found at path X

**Symptom:** The notes stage throws `Template not found at path <path>` and aborts changelog or release notes generation.

**Cause:** `notes.changelog.templates.path` or `notes.releaseNotes.templates.path` points to a directory or file that does not exist relative to the project root.

**Fix:** Verify the path exists:

```bash
ls <path>
```

Paths are resolved relative to the project root (the directory containing `releasekit.config.json`). Use a relative path starting with `./`. If the directory is missing, either create it with the required template files or remove the `templates` block to use the built-in renderer. See the [templates guide](../packages/notes/docs/templates.md) for required file names.

---

## Publish stage

### npm publish failed: ENEEDAUTH

**Symptom:** The publish stage fails with `npm publish failed: ENEEDAUTH` or `code ENEEDAUTH`.

**Cause:** npm could not authenticate. Two common sub-cases:

- **OIDC:** `actions/setup-node` with `registry-url` writes a `.npmrc` that injects `_authToken=${NODE_AUTH_TOKEN}`. If `NODE_AUTH_TOKEN` is unset, npm resolves it to an empty token and fails before attempting the OIDC exchange.
- **Token:** `NODE_AUTH_TOKEN` or `NPM_TOKEN` is not set, or the secret is not passed to the publish step.

**Fix:** For OIDC trusted publishing (recommended), ensure `id-token: write` is in workflow permissions and that each package has an Automation policy configured at npmjs.com. See [ci-setup.md — npm OIDC Trusted Publishing](../packages/release/docs/ci-setup.md#npm-oidc-trusted-publishing-recommended) for the full setup. For token-based publishing, set:

```yaml
env:
  NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

### error: tag vX.Y.Z already exists

**Symptom:** The publish stage fails with `error: tag vX.Y.Z already exists` when creating git tags.

**Cause:** The tag was created locally during a previous partial run but the push failed (or was never attempted). The tag exists locally but not on the remote, or it exists on both after a prior partial publish.

**Fix:** Delete the tag locally and on the remote, then re-run:

```bash
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z
```

Confirm with `git ls-remote --tags origin` before re-running the release.

---

### GitHub release already exists for tag X

**Symptom:** The publish stage logs `GitHub release already exists for tag <tag>` and continues without error.

**Cause:** This is expected behaviour on a re-run. releasekit detects the existing GitHub release and skips creation idempotently. No action is required.

**Fix:** No action required. If you need to update the release body, edit it directly in the GitHub UI.

---

### cargo publish: failed to verify package tarball

**Symptom:** `cargo publish` fails with `failed to verify package tarball` or a similar build-verification error.

**Cause:** Cargo runs a fresh build inside a temporary directory as part of the publish verification step. This can fail if the package depends on files outside the published tree, uses build scripts that require local tooling, or has workspace path dependencies.

**Fix:** As a workaround, set `publish.cargo.noVerify: true` in config:

```json
{
  "publish": {
    "cargo": { "noVerify": true }
  }
}
```

This passes `--no-verify` to `cargo publish`, which skips the tarball rebuild. The package is still published as built — it is the verification step that is skipped, not compilation. Prefer fixing the underlying cause (usually missing `include` entries in `Cargo.toml`) over leaving `noVerify` enabled long-term.

---

### CARGO_REGISTRY_TOKEN not set

**Symptom:** `cargo publish` fails with an authentication error, or the publish stage logs `CARGO_REGISTRY_TOKEN not set`.

**Cause:** The `CARGO_REGISTRY_TOKEN` environment variable is not present. Unlike npm, crates.io does not support OIDC or short-lived tokens — a long-lived API token is required.

**Fix:** Generate a token at [crates.io/settings/tokens](https://crates.io/settings/tokens), add it as a repository secret, and pass it to the publish step:

```yaml
env:
  CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN }}
```

There is no OIDC equivalent for crates.io at this time.

---

## Git stage

### Failed to push: branch protection rules

**Symptom:** The publish stage fails pushing the release commit or tag with a message like `Failed to push: branch protection rules` or `remote: error: GH006: Protected branch update failed`.

**Cause:** The branch has protection rules that block direct pushes. This can affect both the version commit push and the tag push.

**Fix:** Check whether the configured `publish.git.pushMethod` matches the protection ruleset. For GitHub Actions with a bot token, `pushMethod: "https"` is usually required (not SSH). If a bypass is needed, configure the `github-actions[bot]` app as a bypass actor in the branch protection settings rather than disabling protection. Note: `git.skipHooks: true` bypasses local git hooks but has no effect on remote branch protection — these are independent concerns.

---

### fatal: refusing to merge unrelated histories

**Symptom:** git operations fail with `fatal: refusing to merge unrelated histories`.

**Cause:** The checkout is shallow (`fetch-depth` not set to `0`) or the `version.baseSha` config points to a commit not reachable from the current HEAD. releasekit needs full history to walk commits since the last tag.

**Fix:** Set `fetch-depth: 0` on the checkout step:

```yaml
- uses: actions/checkout@v6
  with:
    fetch-depth: 0
```

If `version.baseSha` is set in config, verify the SHA is reachable: `git merge-base --is-ancestor <baseSha> HEAD`.

---

### husky pre-push hook failed

**Symptom:** The publish stage fails when pushing the release commit because a `husky` pre-push hook exits with a non-zero code (for example, a lint or test hook).

**Cause:** The release commit triggers pre-push hooks defined in `.husky/pre-push`. releasekit does not bypass hooks by default.

**Fix:** Set `git.skipHooks: true` in config to pass `--no-verify` to the push command. This is safe for the release commit because the code was already validated when the source PR's CI ran. Alternatively, configure husky to skip in CI by checking `$CI`:

```sh
# .husky/pre-push
[ "$CI" = "true" ] && exit 0
# ... rest of hook
```

---

## General CI patterns

### workflow_run trigger never fires

**Symptom:** A workflow using `workflow_run` as its trigger never starts, even though the upstream workflow completed.

**Cause:** If the upstream CI workflow was cancelled (e.g. due to a concurrent push to `main` with `cancel-in-progress: true`), GitHub does not fire `workflow_run` for the cancelled run.

**Fix:** Use per-SHA concurrency groups on push events so sequential main-branch pushes do not cancel each other:

```yaml
concurrency:
  group: ci-${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.event.pull_request.number || github.sha }}
  cancel-in-progress: true
```

See [ci-setup.md — CI concurrency caveat](../packages/release/docs/ci-setup.md#lifecycle-and-edge-cases) for the full explanation.

---

### Release runs but does nothing / exits with code 0

**Symptom:** The release workflow completes successfully but no version is bumped, no tag is created, and no publish occurs.

**Cause:** Two common cases:

- **Label trigger mode:** the merged PR has no `bump:*` label. Without a bump label, the label trigger exits cleanly.
- **Commit mode:** all commits since the last tag match `ci.skipPatterns` (default `["chore: release "]`) or are non-releasable types under the preset.

**Fix:** In label mode, ensure the merged PR carries a `bump:patch`, `bump:minor`, or `bump:major` label. In commit mode, confirm releasable commits (`feat:`, `fix:`) exist since the last tag with `git log <last-tag>..HEAD --oneline`. Run with `--dry-run --verbose` to see the commit analysis without making changes.

---

### Standing PR not appearing despite merges

**Symptom:** Commits land on `main` but the standing PR is never created or updated.

**Fix:** See the troubleshooting table in [ci-setup.md — Standing Release PR: Troubleshooting](../packages/release/docs/ci-setup.md#troubleshooting). The table covers the four most common causes in order of likelihood.

---

## Debugging tools

releasekit ships three flags useful for diagnosing issues:

**`--dry-run`** — runs the full pipeline without writing files, creating tags, pushing to remote, or publishing to any registry. Use this to confirm what a release would do before enabling it. Output is prefixed with `[dry-run]` in logs.

**`--verbose`** — emits internal decision logs: which commits were found and classified, which packages were discovered, what version strategy was selected, and what LLM requests/responses look like. Use this when the tool exits cleanly but produces an unexpected result.

**`--json`** — emits structured JSON on stdout. Useful for piping between stages or for scripted inspection. The JSON schema is stable across minor versions; text log output is not.

**In CI logs:** expand the failing step to see the full output. Look for the `[dry-run]` prefix to confirm dry-run mode is active, and check for `[warn]` lines that may indicate soft failures (such as the LLM key warning) that did not abort the run but produced degraded output.
