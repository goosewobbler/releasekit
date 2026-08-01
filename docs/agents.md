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
  each decides whether, and on which channel, a package releases.
- Don't edit the manifest comment; run `releasekit standing-pr update` to regenerate it.
- Never publish, tag, or push a release directly. Releases happen on merge, from CI.
- To see what would release: `releasekit preview --dry-run`, or `releasekit release --dry-run --json`.
```

Full detail on the regions: [The standing-PR body is an interface](./standing-pr-body.md).

## The safety boundary

releasekit's standing-PR mode already has the shape the post-incident guidance converged on. Stated explicitly:

**Agent proposes → human approves → CI publishes.**

- An agent contributes the way anyone else does: a feeder PR, or an edit to the standing PR's notes region. It never holds a registry credential.
- The **merge is the approval**, and a branch-protection ruleset on the release branch is what enforces it. This is the actual gate — not the instructions above, which are advisory.
- **CI publishes**, authenticating with short-lived OIDC tokens rather than a long-lived token an agent (or a compromised dependency) could exfiltrate. See [OIDC setup](../packages/release/docs/ci-setup.md).

The properties that matter fall out of that split: nothing an agent does reaches a registry without a human merge, and the credential that can publish exists only inside a CI job, only for its duration.

Two supporting checks: the manifest is validated against the merged source before publishing — versions re-read from the actual package manifests, base SHA required to be an ancestor of `HEAD` — so an edited manifest is refused, not trusted; and selection, channel, and release-control label changes are reverted when made by an unauthorized actor, if [`ci.standingPr.authorization`](./configuration.md) is configured.

## Why not have an AI write your release script?

Because the bespoke release script is the thing that keeps getting attacked, and the one you generate is the one nobody maintains.

The 2024–25 supply-chain incidents that hit publishing pipelines — Ultralytics, s1ngularity, GhostAction — all landed through **bespoke release workflows**, not through a maintained release tool. A generated script has the same exposure with none of the review: it embeds whatever token handling was idiomatic the day it was written, and no one revisits it.

It also rots silently. npm's revocation of classic tokens broke every hand-rolled publish script written before December 2025, all at once. A maintained tool absorbs that kind of registry policy change as an upgrade; a generated script fails at the worst moment, in a job nobody watches until a release is due.

The argument isn't that an agent can't write the script. It's that a release pipeline is a security boundary with a moving spec, which is precisely the thing you want maintained rather than generated once.
