# 2. The agent-facing surface is the CLI, not an MCP server

Date: 2026-07-19

## Status

Accepted.

## Context

As LLM coding agents become a primary way developers run release chores, the question arises of whether releasekit should ship a Model Context Protocol (MCP) server so agents can drive it as a set of tools.

A survey of the 2025–26 MCP-versus-CLI landscape found a strong and consistent signal:

- releasekit is **inner-loop, local/CI, in-repo tooling** — the case where benchmarks show agents succeed at equal rates via a CLI as via an MCP server, at a fraction of the context-token cost (an MCP server re-declares its whole tool surface into the context on every turn).
- No mainstream release tool (semantic-release, changesets, release-please, git-cliff) ships an MCP server; the closest comparable devtool, Nx, *built* one and then migrated its domain knowledge out of it into agent skills, keeping MCP only for its hosted cloud service.
- Anthropic's own engineering guidance and the wider ecosystem have converged on CLIs-with-good-JSON plus lightweight skills as the agent surface for local tooling; MCP earns its keep at cross-system, multi-user, or hosted-service boundaries — none of which releasekit has.

## Decision

ReleaseKit does not ship an MCP server. Its agent-facing surface is three cheaper, higher-leverage layers:

1. **An agent-grade CLI contract** — a uniform `--json` envelope, structured error codes with retry semantics, `changed`-style idempotency reporting, and dry-run as a structured plan. One surface serves humans, CI, and agents.
2. **A shipped skill + AGENTS.md snippet** for consumer repos — how to preview a release, read the standing-PR manifest and marker comments, and what an agent must never do (publish directly, move tags, edit marker lines).
3. **A documented agent-safety boundary** — agent proposes (a PR), human approves (merge, enforced by rulesets), CI publishes via OIDC. releasekit's standing-PR mode is already this topology.

## Consequences

- The CLI JSON contract and the skill become roadmap items in their own right (they serve non-agent users too); no separate MCP surface needs versioning, maintenance, or a security review.
- releasekit forgoes discoverability via MCP registries, betting instead on the skill/AGENTS.md ecosystem, which is where standardization momentum sits.
- **Reconsider-trigger:** releasekit grows a hosted, stateful, cross-repo service (e.g. an org-wide release dashboard or manifest store). That outer-loop boundary is where an MCP server would earn its place.
