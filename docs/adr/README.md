# Architecture Decision Records

Each ADR records one significant, hard-to-reverse decision — the context, the decision, and its consequences — following [Michael Nygard's format](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions). While the work an ADR drives is in progress, a flaw found in it is corrected in place, and its Status says so. Once that work is done, the ADR is immutable: a decision is changed by adding a new ADR that supersedes an older one, not by editing it.

Roadmap sequencing lives in [ROADMAP.md](../../ROADMAP.md); implementation detail lives in issues. ADRs capture only the durable *why* behind a choice.

| # | Decision | Status |
|---|---|---|
| [0001](./0001-language-remains-typescript.md) | ReleaseKit remains a TypeScript codebase | Accepted |
| [0002](./0002-no-mcp-server-cli-is-the-agent-surface.md) | The agent-facing surface is the CLI, not an MCP server | Accepted |
| [0003](./0003-optional-change-file-input.md) | Change files are supported as an optional input, in changesets format | Accepted, amended by 0009 |
| [0004](./0004-ecosystem-enablement-detection-enables-config-opts-out.md) | Ecosystem enablement: detection enables, config opts out | Accepted |
| [0005](./0005-llm-enhanced-notes-require-an-explicit-model-no-defaults.md) | LLM-enhanced release notes require an explicit model; ship no defaults | Accepted, amended by 0006, scoping sentence superseded by 0007 |
| [0006](./0006-check-llm-model-when-the-llm-runs.md) | Check `llm.model` when the LLM runs, not at config load | Accepted |
| [0007](./0007-changelog-is-deterministic.md) | `CHANGELOG.md` is deterministic; LLM output goes only to release surfaces | Accepted |
| [0008](./0008-versions-live-in-a-version-record.md) | Versions live in a committed version record | Accepted |
| [0009](./0009-one-versioning-model-packages-and-groups.md) | One versioning model: packages, coupled by groups | Accepted |
