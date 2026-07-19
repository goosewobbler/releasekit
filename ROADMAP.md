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
- 🔭 Later: surface the computed summary in the standing-PR body; per-package style profiles; streaming CLI output; documented zero-config local-first (Ollama) path.

### Machine-readable & agent-operable surface ⏭️

One surface for humans, CI, and agents. Direction set by [ADR-0002](./docs/adr/0002-no-mcp-server-cli-is-the-agent-surface.md) (CLI + skill, not MCP).

- [ ] CLI contract foundation: uniform `--json` envelope, structured error codes with retry semantics, `changed` reporting, dry-run as a structured plan — [#544](https://github.com/goosewobbler/releasekit/issues/544)
- [ ] Ship a releasekit skill + AGENTS.md snippet + agent-safety docs (propose → approve → CI-publishes-via-OIDC) — [#549](https://github.com/goosewobbler/releasekit/issues/549)
- 🔭 Later: agent-artifact lockstep — `server.json` version-sync + `mcp-publisher publish` as a post-publish step, `plugin.json`/`marketplace.json` as version-manifest targets (gated on the MCP registry reaching GA).

### Trusted publishing & supply chain ⏭️

The field's clearest differentiation window: all three current registries do OIDC, no tool owns it end-to-end, and registry policy churn is the moat argument against hand-rolled scripts.

- [ ] OIDC across registries: `releasekit doctor` config check, crates.io OIDC (currently token-only), first-publish detection, pub.dev tag-pattern templates, npm provenance surfacing — [#546](https://github.com/goosewobbler/releasekit/issues/546)
- 🔭 Later: verified bot commits via the GitHub GraphQL commit API; `publishConfig.registry` audit + a Verdaccio / GitHub Packages / Unity UPM docs page (likely zero code).

### Change intent & migration 📋

Direction and format set by [ADR-0003](./docs/adr/0003-optional-change-file-input.md); intercepts changesets/sampo migrators without displacing the commit-first default.

- [ ] Changesets-format change-file input (unified change stream, `additive`/`only` modes) + `migrate --from-changesets` + an Action-side change-present check — [#545](https://github.com/goosewobbler/releasekit/issues/545)

### Release lifecycle & recovery 📋

Depth in the standing-PR control plane and the roll-forward recovery model — the areas competitors are thinnest.

- [ ] Prerelease escalation + always-visible stabilize preview (resolves the [#335](https://github.com/goosewobbler/releasekit/issues/335) class where labels can't jump a prerelease to a new major line) — design in [#552](https://github.com/goosewobbler/releasekit/issues/552)
- [ ] `releasekit sync`: reconcile local version/tag state against registries; a one-command answer for partial-publish recovery — [#548](https://github.com/goosewobbler/releasekit/issues/548)
- [ ] Graduate backfill out of experimental (dogfood on this repo) — [#539](https://github.com/goosewobbler/releasekit/issues/539)
- 🔭 Later: channel promotion as a first-class op (dist-tag move instead of republish); PR-body/comment budget management (graceful degradation before GitHub's char cap); announce fan-out (webhook + chat targets off the GitHub Release).

---

## Ecosystem Support

ReleaseKit's pipeline is registry-agnostic; this section tracks which ecosystems are wired, which are queued, and which are excluded.

### Supported today

| Ecosystem | Publish model | Notes |
|---|---|---|
| **npm** (JS/TS) | Push API + OIDC + provenance | Reference implementation; the richest path. |
| **crates.io** (Rust) | Push API (token today; OIDC queued in [#546](https://github.com/goosewobbler/releasekit/issues/546)) | Opt-in. |
| **pub.dev** (Dart/Flutter) | Push API + OIDC (tag-triggered) | Opt-in; depth work below. |

### Deepening the supported three ⏭️

Before breadth, the existing three reach parity with their best-in-class single-ecosystem competitors:

- [ ] **pub.dev**: wire pub into the dependency graph (a current correctness hole — prerequisite derivation and publish ordering ignore Dart today), dependent-constraint rewriting in `pubspec.yaml`, Flutter `+N` build-number retention — [#547](https://github.com/goosewobbler/releasekit/issues/547)
- [ ] **crates.io**: API-breakage detection as a pluggable bump-verifier (`max(commit-bump, API-diff-bump)`), first plugin cargo-semver-checks, with ⚠️/✓ badges in the standing PR — [#551](https://github.com/goosewobbler/releasekit/issues/551)
- 🔭 Adopt `cargo publish --workspace` (Cargo ≥1.90) for Rust publish ordering rather than reimplementing it.

### Breadth mechanism 📋

- [ ] **Tag-only registry mode + generic file updaters** — [#550](https://github.com/goosewobbler/releasekit/issues/550). One build unlocks a whole cluster (below) that needs no registry client: version-in-file (sometimes none) + tag + GitHub Release + a per-ecosystem post-step. Ships with GitHub Actions (dogfoodable on releasekit's own action), Terraform module, and C/C++ presets.

### Planned ecosystems

Trigger-gated, not date-gated (see [Evaluation criteria](#evaluation-criteria)). Ordered by readiness × cost-to-serve:

1. **Tag-only cluster** — GitHub Actions, Terraform/OpenTofu modules, C/C++, Swift, Zig. *Unblocked by [#550](https://github.com/goosewobbler/releasekit/issues/550); GitHub Actions passes the "only what I use" bar today (releasekit ships an action). No registry client, small.*
2. **JSR** — *Near-free adjacency to npm (jsr.json is package.json-shaped); best OIDC story of any registry. Framing: one PR keeps package.json + deno.json in lockstep and publishes to npm + JSR. Do when convenient.*
3. **Python / PyPI (uv workspaces)** — *The strongest new-ecosystem case: the uv-workspace release gap is open and unowned (PSR is monorepo-weak, release-please doesn't publish, uv ships only primitives), PyPI leads on OIDC/attestations, filename immutability matches roll-forward. Cost: a PEP 440 bridge + a dynamic-versioning policy. Trigger: a demand signal or own usage; the window may close if Astral moves.*
4. **.NET / NuGet** — *Best demand-to-cost of the traditional ecosystems: incumbents stop at version calculation, the monorepo gap is unfilled, npm-shaped registry, trusted publishing fresh (Sept 2025). Trigger: demand signal.*
5. **Ruby / RubyGems** — *Cheap, OIDC-mature since 2023, community already assembles this shape by hand. Capped upside (modest TAM, registry-governance noise). Trigger: demand signal.*
6. **Elixir + Gleam / Hex** — *Demand validated (sampo shipped it wave 1); Gleam rides the same registry free. Trigger: Hex ships trusted publishing (announced Mar 2026, unshipped).*
7. **Helm charts** — *Real k8s-monorepo fit; syncing `appVersion` to a sibling package releasekit also releases would be unique. Trigger: after the chart-`version`/`appVersion` duality is designed.*
8. **Go** — *MVP is cheap (tag-only + subdir tags); the differentiating part (multi-module `require` rewriting with tag ordering) is the expensive part, and `/v2` majors are a source codemod against an immutable proxy. Scope: majors hard-error with guidance, `retract` flow as the novel bit. Trigger: after Python.*
9. **PHP / Packagist** — *No publish step (webhook reads tags); a weekend-sized adapter that validates the publishless path. Weak demand and cultural fit. Opportunistic filler.*

### Not planned

Evaluated and excluded. Recorded so the question resolves to a lookup, not fresh research.

| Ecosystem / surface | Reason |
|---|---|
| **Maven Central** (⇒ Java, Scala, Kotlin Multiplatform) | Mandatory GPG signing (a new support-burden class), multiple build systems, SNAPSHOT culture that fights the roll-forward model, and **no OIDC** — the one ecosystem that actively undermines the trusted-publishing strategy. Scala adds a beloved incumbent (sbt-ci-release) and tag-*derived* versioning inverted from releasekit's model. **Revisit only if** Sonatype ships OIDC *and* drops/automates GPG. |
| **App stores & marketplaces with async review** (iOS/macOS/Play, Chrome Web Store, Mozilla Add-ons, VS Code, JetBrains, ChatGPT apps) | "Published" is not synchronously verifiable — it requires a third publish state ("submitted, pending review") the roll-forward model deliberately lacks. Owned by fastlane/EAS/vsce. Off-axis: releasekit releases library packages, not reviewed application binaries. |
| **Publish-by-PR indexes** (Homebrew core, conda-forge, nixpkgs, winget, Flathub, deb/rpm) | Not a registry class — it's opening a PR against a shared index repo, already automated by index-side bots. If ever built, it is a post-publish *announce hook* on the existing forge layer, not a publish target. |
| **ML model hubs** (Hugging Face, ModelScope, Kaggle, Ollama) | The repo *is* the registry (git-push-as-publish); no immutable version coordinate, and commit types don't map to weight changes. releasekit's model mismatches at every stage. |
| **Snapcraft / binary distribution** (cargo-dist territory) | Ships application binaries, not library packages — a different product; owned by GoReleaser/JReleaser. Its channel-promotion semantics are worth borrowing (see the lifecycle theme), the target isn't. |

---

## Evaluation criteria

How features and ecosystems get prioritized and sequenced:

1. **Widen the moat first.** Standing-PR depth, notes quality, and trusted publishing are where releasekit is differentiated and competitors are thin; these outrank breadth.
2. **Depth over breadth for ecosystems.** Polyglot breadth without depth is a maintenance trap. Each shipped ecosystem must be maintainable by a solo maintainer; the three current ones reach best-in-class parity before new ones are added.
3. **Ecosystem expansion is trigger-gated, not scheduled.** A queued ecosystem ships when its trigger fires — a real consumer (or the maintainer's own usage) needs it, or a blocking dependency (e.g. a registry's trusted publishing) lands. This keeps the "only ecosystems I actually use/maintain" constraint enforceable.
4. **Registry-model fit is a gate.** A target must map onto version → notes → (optional) publish with synchronous idempotency. Async-review, publish-by-PR, and repo-is-the-registry models are excluded on this basis (see Not planned).
5. **Prefer one general mechanism to many special cases.** The tag-only mode + generic updaters serve a whole ecosystem cluster from a single build; the bump-verifier is a pluggable slot, not a cargo special case.

---

## Status disclaimer

Sequencing reflects current intent and shifts with real-world demand, maintainer availability, and upstream ecosystem changes (registry policies, trusted-publishing rollouts). Themes are durable; the order within and between them is not a commitment.
