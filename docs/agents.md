# Agents

releasekit's agent surface is its CLI contract, not an MCP server — see [ADR-0002](./adr/0002-no-mcp-server-cli-is-the-agent-surface.md). Every orchestration command speaks the same [JSON envelope](./cli.md#json-output-contract), with structured error codes and a `changed` flag, so an agent can act on results without scraping prose.

This page covers the rest: what an agent needs to know about a repo that uses releasekit, and where the safety boundary sits.

## AGENTS.md snippet

Paste into your repository's `AGENTS.md` (or `CLAUDE.md`):

```markdown
## Releases (releasekit)

Releases run from an open standing release PR. Its body contains machine-read regions
delimited by `<!-- releasekit-* -->` / `<!-- rk-* -->` markers — reflowing the markdown or
stripping those comments changes what ships.

- Never edit, move, or delete a marker comment. Rewording a row's visible label is fine.
- Write release notes only between the `releasekit-notes` markers.
- Don't tick/untick the "Packages to release" rows unless that is the change being asked for —
  each decides whether, and on which channel, a package releases. A change applies only once
  the bot rebuilds the PR.
- Don't add/remove `bump:*`, `channel:*`, `scope:*`, `graduate:*` or `release:*` labels on any
  PR unless asked — `release:immediate` on a feeder PR releases it directly on merge.
- Don't edit the manifest comment, and never run `releasekit standing-pr update` yourself — it
  resets and force-pushes the release branch. If the manifest looks stale, ask a maintainer to
  re-run the Standing Release PR workflow.
- Never publish, tag, or push a release directly. Releases happen on merge, from CI.
- To see what will release, read the open standing release PR. Local `--dry-run` commands
  don't apply its labels or checklist.
```

Full detail on the regions: [The standing-PR body is an interface](./standing-pr-body.md).

## The safety boundary

releasekit's standing-PR mode already has the shape the post-incident guidance converged on. Stated explicitly:

**Agent proposes → human approves → CI publishes.**

- An agent contributes the way anyone else does: a feeder PR, or an edit to the standing PR's notes region. It should never hold a registry credential.
- The **merge is the approval**, and a review-required ruleset on the base branch (`main`) is what enforces it. This is the actual gate — not the instructions above, which are advisory. Locking `release/next` separately stops commits being pushed into the release; see [Branch rulesets](../packages/release/docs/ci-setup.md#branch-rulesets-the-merge-gate). The template workflow needs *Allow GitHub Actions to create and approve pull requests*, which lets workflows approve pull requests too — so require code-owner review by humans, not just "≥ 1 approval".
- **CI publishes**, using short-lived OIDC tokens where the registry supports them — npm does, and so does pub.dev for workflow runs its automated-publishing settings accept (it limits which events may publish). See [OIDC setup](../packages/release/docs/ci-setup.md#npm-oidc-trusted-publishing-recommended) and [Dart / pub.dev](./dart.md#auth).

The property that matters most — nothing an agent does reaches a registry without a human merge — holds only while the agent can't get around that merge:

- it can't merge or approve PRs itself, or satisfy or bypass the review ruleset;
- it can't start a publish another way — dispatching a release workflow, or applying `release:retry`;
- it can't reach the publish credentials — keep registry secrets and trusted-publisher bindings scoped to a protected environment that only the release job uses.

In `direct` mode there is no standing PR: merging a feeder PR to `main` is what releases, so that merge is the approval.

[`ci.standingPr.authorization`](./configuration.md#cistandingpr) doesn't restrain an agent acting through a GitHub App or bot account: every bot actor counts as authorized. Keep such agents off release labels, merge rights and ruleset bypass lists.

**crates.io is the exception on credentials.** crates.io supports trusted publishing, but releasekit doesn't use it yet ([#546](https://github.com/goosewobbler/releasekit/issues/546)) — its cargo publish reads `CARGO_REGISTRY_TOKEN`, which in practice is a long-lived repository secret. That secret outlives any single job, so it wants the handling a long-lived credential always wants — scoped as narrowly as the registry allows, rotated, and restricted to the environment the release job runs in.

Two supporting checks: the manifest is checked at publish against the merged source — bot-authored comment, base SHA an ancestor of `HEAD`, packages, versions and tags matching what was merged — so it can't publish anything that isn't in the merged code, though it is not a tamper-proof record of the selection; and selection, channel, and release-control label changes are reverted when made by an unauthorized actor, if [`ci.standingPr.authorization`](./configuration.md#cistandingpr) is configured.

## Why not have an AI write your release script?

Because the bespoke release script is the thing that keeps getting attacked, and the one you generate is the one nobody maintains.

Two of the 2024–25 supply-chain incidents that hit publishing pipelines — Ultralytics and s1ngularity (Nx) — landed through flaws in the projects' own hand-written CI workflows, not through a maintained release tool. A generated script has the same exposure with none of the review: it embeds whatever token handling was idiomatic the day it was written, and no one revisits it.

It also rots silently. npm's revocation of classic tokens in late 2025 broke every publish script still authenticating with one, all at once. A maintained tool absorbs that kind of registry policy change as an upgrade; a generated script fails at the worst moment, in a job nobody watches until a release is due.

The argument isn't that an agent can't write the script. It's that a release pipeline is a security boundary with a moving spec, which is precisely the thing you want maintained rather than generated once.
