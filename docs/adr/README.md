# Architecture Decision Records

Each ADR records one significant, hard-to-reverse decision — the context, the decision, and its consequences — following [Michael Nygard's format](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions). ADRs are immutable once accepted; a decision is changed by adding a new ADR that supersedes an older one, not by editing it.

Roadmap sequencing lives in [ROADMAP.md](../../ROADMAP.md); implementation detail lives in issues. ADRs capture only the durable *why* behind a choice.

| # | Decision | Status |
|---|---|---|
| [0001](./0001-language-remains-typescript.md) | ReleaseKit remains a TypeScript codebase | Accepted |
| [0002](./0002-no-mcp-server-cli-is-the-agent-surface.md) | The agent-facing surface is the CLI, not an MCP server | Accepted |
| [0003](./0003-optional-change-file-input.md) | Change files are supported as an optional input, in changesets format | Accepted |
| [0004](./0004-ecosystem-enablement-detection-enables-config-opts-out.md) | Ecosystem enablement: detection enables, config opts out | Accepted |
| [0005](./0005-require-an-explicit-llm-model-no-defaults.md) | Require an explicit LLM model; ship no defaults | Accepted |
