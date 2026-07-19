# Roadmap

Development sequencing for ReleaseKit, grouped by theme. Each theme is a durable track that outlives any single ticket; the checklists within move as work lands. Architecture decisions live in [docs/adr](./docs/adr); implementation detail lives in the linked issues.

Status legend: 🚧 in flight · ⏭️ near-term · 📋 planned · 🔭 later.

**Current focus:** hardening release notes (the differentiator) and laying the machine-readable CLI foundation, then the two competitive fronts — change-file support and trusted publishing.

---

## Themes

### Release notes & LLM enhancement 🚧

The clearest differentiator — no competitor ships LLM-enhanced notes — so the bar is "novel *and* defensible".

- [ ] Security hardening: neutralize `<!-- releasekit-* -->` marker sequences in LLM and edited-region output; delimit attacker-writable commit text in prompts — [#540](https://github.com/goosewobbler/releasekit/issues/540)
- [ ] Kill model-ID rot: optional `llm.model` with curated per-provider tiers refreshed each release; enum-validate `provider` — [#541](https://github.com/goosewobbler/releasekit/issues/541)
- [ ] Quality guardrail: eval harness (golden fixtures + cached-response replay + prompt snapshots) so the differentiator can't silently regress — [#542](https://github.com/goosewobbler/releasekit/issues/542)
- [ ] Reliability batch: per-task soft-fail, thinking-model text path, retry classification, large-release chunking, concurrency bound — [#543](https://github.com/goosewobbler/releasekit/issues/543)
- 🔭 Surface the computed release summary in the standing-PR body (reuse the existing `summarize` output).
- 🔭 Per-package style profiles — distinct voice for user-facing vs internal packages.
- 🔭 Streaming provider output for CLI / backfill UX.
- 🔭 Zero-config local-first path (Ollama) documented as the keyless default.

### Machine-readable & agent-operable surface ⏭️

One surface for humans, CI, and agents. Direction set by [ADR-0002](./docs/adr/0002-no-mcp-server-cli-is-the-agent-surface.md) (CLI + skill, not MCP).

- [ ] CLI contract foundation: uniform `--json` envelope, structured error codes with retry semantics, `changed` reporting, dry-run as a structured plan — [#544](https://github.com/goosewobbler/releasekit/issues/544)
- [ ] Ship a releasekit skill + AGENTS.md snippet + agent-safety docs (propose → approve → CI-publishes-via-OIDC) — [#549](https://github.com/goosewobbler/releasekit/issues/549)
- 🔭 Agent-artifact lockstep — keep an MCP server's npm package, its `server.json`, and any plugin/skill wrapper on one version; `server.json` sync + `mcp-publisher publish` as a post-publish step. Gated on the MCP registry reaching GA.

### Trusted publishing & supply chain ⏭️

The field's clearest differentiation window: all three current registries do OIDC, no tool owns it end-to-end, and registry policy churn is the moat argument against hand-rolled scripts.

- [ ] OIDC across registries: `releasekit doctor` config check, crates.io OIDC (currently token-only), first-publish detection, pub.dev tag-pattern templates, npm provenance surfacing — [#546](https://github.com/goosewobbler/releasekit/issues/546)
- 🔭 Verified bot commits via the GitHub GraphQL commit API (standing-PR commits show as Verified).
- 🔭 `publishConfig.registry` audit + a Verdaccio / GitHub Packages / Unity UPM docs page (npm-protocol reuse; likely zero code).

### Change intent & migration 📋

Direction and format set by [ADR-0003](./docs/adr/0003-optional-change-file-input.md); intercepts changesets/sampo migrators without displacing the commit-first default.

- [ ] Changesets-format change-file input (unified change stream, `additive`/`only` modes) + `migrate --from-changesets` + an Action-side change-present check — [#545](https://github.com/goosewobbler/releasekit/issues/545)

### Release lifecycle & recovery 📋

Depth in the standing-PR control plane and the roll-forward recovery model — the areas competitors are thinnest.

- [ ] Prerelease escalation + always-visible stabilize preview (resolves the [#335](https://github.com/goosewobbler/releasekit/issues/335) class where labels can't jump a prerelease to a new major line) — design in [#552](https://github.com/goosewobbler/releasekit/issues/552)
- [ ] `releasekit sync`: reconcile local version/tag state against registries; a one-command answer for partial-publish recovery — [#548](https://github.com/goosewobbler/releasekit/issues/548)
- [ ] Graduate backfill out of experimental (dogfood on this repo) — [#539](https://github.com/goosewobbler/releasekit/issues/539)
- 🔭 Channel promotion as a first-class op — move an npm dist-tag instead of republishing when graduating a prerelease.
- 🔭 PR-body / comment budget management — graceful degradation before GitHub's character cap.
- 🔭 Announce fan-out — a generic webhook plus a few chat targets (Discord/Slack/Mastodon) off the GitHub Release. First step toward the post-publish propagation in [Possible future scope](#possible-future-scope).

---

## Ecosystem Support

ReleaseKit's pipeline is registry-agnostic; this section tracks which ecosystems are wired, which are queued, which are possible future scope, and which are excluded.

### Supported today

| Ecosystem | Publish model |
|---|---|
| **npm** (JS/TS) | Push API, OIDC, provenance |
| **crates.io** (Rust) | Push API (OIDC queued — [#546](https://github.com/goosewobbler/releasekit/issues/546)) |
| **pub.dev** (Dart/Flutter) | Push API, OIDC (tag-triggered) |

Publishing defaults are currently asymmetric (npm on, crates.io/pub.dev opt-in), and npm alone has no version-handling opt-out. [#554](https://github.com/goosewobbler/releasekit/issues/554) unifies both layers to "detection enables, config opts out" — every detected ecosystem versioned and published by default, symmetric opt-outs at each layer.

### Deepening the supported three ⏭️

Before breadth, the existing three reach parity with their best-in-class single-ecosystem competitors:

- [ ] **pub.dev**: wire pub into the dependency graph (a current correctness hole — prerequisite derivation and publish ordering ignore Dart today), dependent-constraint rewriting in `pubspec.yaml`, Flutter `+N` build-number retention — [#547](https://github.com/goosewobbler/releasekit/issues/547)
- [ ] **crates.io**: API-breakage detection as a pluggable bump-verifier (`max(commit-bump, API-diff-bump)`), first plugin cargo-semver-checks, with ⚠️/✓ badges in the standing PR — [#551](https://github.com/goosewobbler/releasekit/issues/551)
- 🔭 Adopt `cargo publish --workspace` (Cargo ≥1.90) for Rust publish ordering rather than reimplementing it.

### Breadth mechanism 📋

- [ ] **Tag-only registry mode + generic file updaters** — [#550](https://github.com/goosewobbler/releasekit/issues/550). One build unlocks a whole cluster (below) that needs no registry client: version-in-file (sometimes none) + tag + GitHub Release + a per-ecosystem post-step. Ships with GitHub Actions (dogfoodable on releasekit's own action), Terraform module, and C/C++ presets.

### Planned ecosystems

Extending the multi-ecosystem promise, these are commitments — mainstream ecosystems are a matter of when, not if. Ordered by cost-to-serve × strategic value, not by date. A concrete consumer (or the maintainer's own usage) moves an item up the order; it does not unlock it.

1. **Tag-only cluster** — GitHub Actions, Terraform/OpenTofu modules, C/C++, Swift, Zig. Unblocked by [#550](https://github.com/goosewobbler/releasekit/issues/550); no registry client, small. GitHub Actions is dogfoodable on releasekit's own composite action.
2. **JSR** — near-free adjacency to npm (jsr.json is package.json-shaped) and the best OIDC story of any registry. One PR keeps package.json + deno.json in lockstep across npm + JSR.
3. **Python / PyPI (uv workspaces)** — the strongest case: the uv-workspace release gap is open and unowned (python-semantic-release is monorepo-weak, release-please doesn't publish, uv ships only primitives), PyPI leads on OIDC/attestations, and filename immutability matches the roll-forward model. Cost: a PEP 440 bridge and a dynamic-versioning (setuptools-scm / hatch-vcs) policy.
4. **.NET / NuGet** — incumbents stop at version calculation, the monorepo/release-PR gap is unfilled, the registry is npm-shaped, and trusted publishing is fresh (Sept 2025). Cheap parser.
5. **Ruby / RubyGems** — cheap, OIDC-mature since 2023; the one new parser class is the `version.rb` constant. Capped upside (modest reach, registry-governance noise).
6. **Go** — the MVP is cheap (tag-only + subdir-prefixed tags), but the differentiating part — multi-module `require` rewriting with tag ordering — is the expensive part, and `/v2` majors are a source codemod against an immutable proxy. Scope: majors hard-error with migration guidance; the `retract` flow is the novel differentiator.
7. **PHP / Packagist** — a small adapter (Packagist reads tags; no publish step). Lower priority not because PHP is small — it isn't — but because releasekit's specific value-add is thinner there: conventional-commit culture is less common, and the large multi-package frameworks (Symfony, Laravel) release via subtree-splits releasekit doesn't serve.

**Gated on a prerequisite** (a genuine block, not just ordering):

- **Elixir + Gleam / Hex** — demand validated (sampo shipped it in its first wave) and Gleam rides the same registry for free. Waiting on Hex trusted publishing (announced Mar 2026, not yet shipped) so it lands OIDC-first like the others.
- **Helm charts** — real k8s-monorepo fit, and syncing `appVersion` to a sibling package releasekit also releases would be genuinely unique. Needs the chart-`version` / `appVersion` duality designed first.

### Possible future scope

Outside releasekit's current mission (version → notes → publish for library packages), but on a coherent growth path — the version/notes/tag half is already releasekit's. Not commitments; recorded so the boundary is a considered decision. Revisited only after the core themes mature.

- **Binary / artifact distribution** — build, checksum, sign, and attach cross-platform binaries and installers to the GitHub Release releasekit already creates (the cargo-dist / GoReleaser space; cargo-dist itself is in caretaker limbo). Natural shape: a separate `@releasekit/dist`-style package, or a documented hand-off triggered by releasekit's tags — not a change to the core pipeline. Would also absorb Snapcraft and OS packaging.
- **Post-publish propagation** — after a clean publish, open a PR to bump a Homebrew tap or a winget / nixpkgs entry, or ping an index. Reuses the existing `forge` layer (fork → branch → PR → poll-merge) and serves releasekit's actual audience (a library author who also ships a CLI). The chat-announce fan-out in the lifecycle theme is the first step on this path.

### Not planned

Genuinely excluded — wrong model class or off-mission. A separate product could tackle some (noted); they are not releasekit.

| Ecosystem / surface | Reason |
|---|---|
| **Maven Central** (⇒ Java, Scala, Kotlin Multiplatform) | Mandatory GPG signing (a new support-burden class), multiple build systems, SNAPSHOT culture that fights the roll-forward model, and **no OIDC** — the one ecosystem that actively undermines the trusted-publishing strategy. Scala adds a beloved incumbent (sbt-ci-release) and tag-*derived* versioning inverted from releasekit's model. **Revisit only if** Sonatype ships OIDC *and* drops/automates GPG. |
| **App stores & async-review marketplaces** (iOS/macOS/Play, Chrome Web Store, Mozilla Add-ons, VS Code, JetBrains, ChatGPT apps) | "Published" is not synchronously verifiable — it needs a third publish state ("submitted, pending review") the roll-forward model deliberately lacks. A dedicated tool with that state machine could serve these, but it is a different product for a different audience that fastlane / EAS / vsce already own — off releasekit's library-publishing axis. |
| **ML model hubs** (Hugging Face, ModelScope, Kaggle, Ollama) | The repo *is* the registry (git-push-as-publish); no immutable version coordinate, and commit types don't map to weight changes. releasekit's model mismatches at every stage. |

---

## Evaluation criteria

How features and ecosystems get prioritized and sequenced:

1. **Widen the moat first.** Standing-PR depth, notes quality, and trusted publishing are where releasekit is differentiated and competitors are thin; these outrank breadth.
2. **Depth over breadth for ecosystems.** Polyglot breadth without depth is a maintenance trap. Each shipped ecosystem must be maintainable by a solo maintainer; the three current ones reach best-in-class parity before new ones are added.
3. **Ecosystem expansion is capacity-ordered, not demand-gated.** For a multi-ecosystem tool the mainstream ecosystems (Python, NuGet, Ruby, Go…) are a matter of when, not if; they are ordered by cost-to-serve × strategic value and shipped as solo-maintainer capacity allows. A concrete consumer or the maintainer's own usage moves an item up the order rather than unlocking it. The only hard gates are an external prerequisite (a registry's trusted publishing) or an unresolved internal design question.
4. **Registry-model fit is a gate.** A target must map onto version → notes → (optional) publish with synchronous idempotency. Async-review and repo-is-the-registry models are excluded on this basis (see Not planned). Publish-by-PR is excluded as a *publish target* but is viable as a post-publish hook (see Possible future scope).
5. **Prefer one general mechanism to many special cases.** The tag-only mode + generic updaters serve a whole ecosystem cluster from a single build; the bump-verifier is a pluggable slot, not a cargo special case.

---

## Status disclaimer

Sequencing reflects current intent and shifts with real-world demand, maintainer availability, and upstream ecosystem changes (registry policies, trusted-publishing rollouts). Themes are durable; the order within and between them is not a commitment.
