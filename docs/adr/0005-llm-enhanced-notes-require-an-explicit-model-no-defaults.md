# 5. LLM-enhanced release notes require an explicit model; ship no defaults

Date: 2026-07-19

## Status

Accepted. Implementation tracked in [#541](https://github.com/goosewobbler/releasekit/issues/541).

## Context

LLM-enhanced release notes need a model id per provider. The obvious convenience is to ship a curated default per provider so a user can set `provider` and omit `model`.

Model ids rot. Verifying the defaults while implementing this showed the openai default we were about to ship — `gpt-4o-mini` — was already deprecated and removed from OpenAI's API. A shipped default is therefore two liabilities at once: a per-release maintenance treadmill for ReleaseKit (every default must be re-checked and bumped as providers churn), and a silent failure mode for consumers (anyone relying on the default breaks the day the provider removes that model).

Crucially, there is no zero-config path to protect: LLM enhancement is already an explicit opt-in that requires an API key (or a running Ollama with a model already pulled). Naming the model is a marginal addition to a setup the user has already committed to.

## Decision

This decision is scoped to LLM-enhanced release notes — the only place ReleaseKit calls a model. Versioning, changelog generation, and publishing are deterministic and LLM-free; this decision does not touch them.

**For LLM-enhanced release notes, ReleaseKit ships no model defaults. When enhancement is enabled, `llm.model` is required and validated at config load.**

- `llm.model` is a required, non-empty string (Zod `z.string().min(1)`) — a missing or empty model fails at config validation, not silently inside the notes soft-fail catch.
- `provider` is a closed Zod enum (`openai | openai-compatible | anthropic | ollama`); `openai-compatible` additionally requires `baseURL`.
- Configs assembled in-process (the CLI's `--llm-*` flags, which bypass `loadConfig`'s Zod pass) are run through the same schema before use, so a bad provider or missing model fails loud (non-zero exit) rather than degrading to non-LLM notes.

## Consequences

- Zero model-id maintenance for ReleaseKit: no default to track, re-verify, or get wrong. The consumer owns the fast-moving model choice for their account and budget — the party best placed to keep it current.
- Fail-loud at config validation is consistent with the `provider`/`baseURL` validation this decision also introduces; misconfiguration surfaces at load, not three stages deep.
- The "zero-config local-first Ollama" story loses its literal zero-config-ness — a user must name their local model. Acceptable: an Ollama user already has to run the server and pull a model, so they know its name.
- Docs use a `<your-model>` placeholder in examples rather than a real id, so the examples themselves can't rot into recommending a dead model — the same rot this ADR refuses to ship in code.
