# 6. Check `llm.model` when the LLM runs, not at config load

Date: 2026-11-10

## Status

Accepted. Amends [0005](./0005-llm-enhanced-notes-require-an-explicit-model-no-defaults.md): ReleaseKit still ships no model defaults, but `llm.model` is no longer required at config load. Implementation tracked in [#811](https://github.com/goosewobbler/releasekit/issues/811).

## Context

0005 validated `llm.model` at config load. Every command loads the whole config, so runs that never call the LLM needed a model too: `preview`, `gate`, `release --skip-notes`, and standing-PR updates without the preview-notes label.

That breaks a model taken from the environment. webdriverio/desktop-mobile sets `"model": "{env:OLLAMA_MODEL}"` so the model can be changed in the repository settings. GitHub doesn't pass repository variables to runs for pull requests from forks, so the release preview failed at load although it skips notes, and the workflow had to set a placeholder (`OLLAMA_MODEL: unused`). An unset variable also failed every command with `notes.releaseNotes: Invalid input`, naming neither the field nor the variable.

## Decision

`llm.model` is optional at config load. It's checked when a run is about to call the LLM: the `llm` block has at least one task on, and the run doesn't skip release notes. The rest of `llm` (`provider`, `baseURL`, options) is still validated at load, and `"model": ""` still fails there.

The check fails loud and names the field, and the variable when the value came from an unset `{env:}` reference: `notes.releaseNotes.llm.model: {env:OLLAMA_MODEL} is not set`. A direct `release` runs it before writing the version bumps.

## Consequences

- Runs that don't call the LLM work without a model, so the placeholder can go.
- A missing model surfaces at the notes step instead of at load. A direct release still fails before changing anything on disk. Where notes failures are already non-fatal (standing-PR publish), it's a warning, and the release goes out with GitHub's generated notes.
- 0005's no-defaults decision and its reasoning stand.
