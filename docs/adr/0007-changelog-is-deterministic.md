# 7. `CHANGELOG.md` is deterministic; LLM output goes only to release surfaces

Date: 2026-11-17

## Status

Accepted. Supersedes [0005](./0005-llm-enhanced-notes-require-an-explicit-model-no-defaults.md)'s scoping sentence "Versioning, changelog generation, and publishing are deterministic and LLM-free"; the rest of 0005 stands. Implementation tracked in [#789](https://github.com/goosewobbler/releasekit/issues/789).

## Context

0005's sentence was an aside added in [#568](https://github.com/goosewobbler/releasekit/issues/568), and it was already untrue: in direct mode the LLM summary and categories were rendered into `CHANGELOG.md`. Standing-PR mode kept the file plain, except on the update that seeded preview notes, so the file depended on which update ran last.

An LLM-categorized changelog in standing-PR mode ([#876](https://github.com/goosewobbler/releasekit/issues/876)) would have needed per-key caching in the manifest, so each update didn't rewrite the file with fresh LLM output and bury the real diff.

## Decision

`CHANGELOG.md` (root, per-package and custom changelog templates) is rendered only from the commit-derived entries, in every mode.

The LLM tasks (`enhance`, `categorize`, `summarize`, `releaseNotes`) shape only release surfaces: GitHub release bodies, per-version notes files and the standing PR's notes region.

## Consequences

- The changelog is reproducible from history, and its standing-PR diff shows only real changes.
- Direct, immediate and standing-PR releases write the same changelog.
- Direct-mode users lose the LLM summary and categories in `CHANGELOG.md`. This is a breaking change, accepted before 1.0.
- #876 is dropped.
