# Roadmap

Distilled from the July 2026 direction review: ~40 tools and ecosystems surveyed, with code-level analysis of changesets, release-please, semantic-release, release-plz, knope, git-cliff, melos, and sampo, plus an 11-class taxonomy of publishing models. The full research document is retained by the maintainer outside the repo; this file records the decisions, the sequence, and the triggers for revisiting them.

## Positioning

No surveyed tool combines releasekit's three pillars — interactive standing-PR control plane, multi-registry publishing, and LLM-enhanced notes. The nearest competitors each miss at least one: release-please doesn't publish (and Google is sunsetting it), release-plz is Rust-only, knope doesn't publish, melos has no release PR, sampo has no conventional-commit input, no OIDC, and a static release PR. The moat to widen: standing-PR depth, notes quality, trusted publishing, and the agent-safety story. The moat argument against LLM-generated bespoke release scripts: registries churn policy (npm's classic-token revocation broke every pre-Dec-2025 hand-rolled script), and the hard 20% — idempotent multi-registry retry, roll-forward recovery, OIDC quirks — is exactly what one-shot scripts get wrong.

## Settled decisions

| Decision | Rationale (short) | Reconsider when |
|---|---|---|
| **Stay TypeScript** — no Rust core, no rewrite | Workload is IO-bound (the biome/oxc rationale doesn't transfer); no official Anthropic Rust SDK for the LLM moat; sampo's own npm shim still requires Node; EJS templates and in-flight `VersionOutput` manifests would break; solo+agent velocity is TS-anchored | Measured CPU-bound hotspot; official Anthropic Rust SDK *and* evidence Node blocks adoption; multi-maintainer team. Probe binary-distribution demand with Node SEA / `bun build --compile` first — never as a language decision |
| **No MCP server** | Inner-loop local/CI tooling; CLI-with-JSON beats MCP on tokens and equals it on success rates; Nx built one and migrated the knowledge out into skills | releasekit grows a hosted, stateful service |
| **Change files: in, as an option** (#545) | Intercept changesets migrators who would otherwise land on sampo; knope proves commits+files unify | — (decided; conventional commits stay the default) |
| **Ecosystem policy: depth over breadth** | Polyglot breadth without depth is knope's position; release-please died of maintenance burden; every shipped ecosystem must be maintainable by one person | Per-ecosystem triggers below |
| **Publish-by-PR indexes, async-review stores, ML hubs: never registry targets** | Wrong model class (forge-territory, third publish state, no version coordinate — respectively) | Documented per class in the review |

## Now (in order)

1. **#540** LLM security pack — marker-sequence neutralization + prompt-injection hardening (P1, small)
2. **#541** LLM model defaults — optional `model`, curated per-provider tiers, `provider` enum
3. **#544** Agent-grade CLI contract — uniform JSON envelope, error codes, `changed`, structured plan output (foundation)
4. **#545** Change-file support (changesets-compatible) + `migrate --from-changesets`
5. **#546** Trusted publishing (OIDC) — doctor, crates.io OIDC, first-publish detection, provenance

## Next

6. **#547** pub.dev depth — graph wiring (correctness hole), constraint rewriting, Flutter build numbers
7. **#543** LLM reliability batch + **#542** eval harness
8. **#548** `releasekit sync` — registry reconciliation
9. **#549** Agent surface — skill, AGENTS.md snippet, safety docs (after #544)
10. **#550** Tag-only mode + generic updaters — GitHub Actions, Terraform, C/C++ presets
11. **#551** Bump-verifier slot + cargo-semver-checks
12. **#552** Prerelease escalation + stabilize preview (design; resolves the #335 class)

## Later (small, slot anywhere)

- Channel promotion as a first-class op (npm dist-tag move instead of republish; extends channel toggles)
- Adopt `cargo publish --workspace` (Cargo ≥1.90) for Rust publish ordering
- Verified bot commits via GitHub GraphQL (standing-PR commits show as Verified)
- PR-body/comment budget management (65,536-char cap with graceful degradation)
- Announce fan-out (generic webhook + 2–3 chat targets off the GitHub Release)
- npm `publishConfig.registry` audit + docs page (Verdaccio / GitHub Packages / Unity UPM — likely zero code)
- Agent-artifact lockstep: `server.json` version-sync + `mcp-publisher publish` post-step; `plugin.json`/`marketplace.json` as version-manifest targets (MCP registry API is v0.1 preview — expect churn until GA)
- Backfill graduation — dogfood tracked in #539

## Ecosystem queue (behind triggers)

| Ecosystem | Trigger |
|---|---|
| JSR | When convenient — near-free adjacency to npm; best OIDC story of any registry |
| Python (PyPI / uv workspaces) | Demand signal or own usage — the uv-workspace release gap is open and unowned; window may close if Astral moves |
| .NET (NuGet) | Demand signal — strongest demand-to-cost of the traditional ecosystems; trusted publishing fresh (Sept 2025) |
| Ruby (RubyGems) | Demand signal — cheap, OIDC-mature since 2023 |
| Elixir + Gleam (Hex) | Hex ships trusted publishing (announced Mar 2026, unshipped); note sampo is already there |
| Helm charts | After appVersion-sync design; k8s-monorepo fit is real |
| Go | After Python, scoped: tag-only + subdir tags; majors hard-error; `retract` flow as differentiator |
| PHP (Packagist) | Opportunistic — weekend-sized, weak demand |
| Maven Central (⇒ Java, Scala, Kotlin) | Standing no — mandatory GPG, no OIDC, SNAPSHOT culture. Revisit only if Sonatype ships OIDC *and* drops/automates GPG |

## Watch

- **sampo** — the only tool converging on the same multi-registry pitch; racing the ecosystem queue (Hex, PyPI shipped). Its prerelease design and npm binary-carrier distribution are documented reference points; its static PR, half-built failure handling, and missing OIDC are the gaps to keep wide.
- **Bumpy** (changesets-successor claim), **release-please migration wave** (be findable: comparison + migration docs), **OCI-as-universal-registry** (WASM components, Helm — consider an OCI transport at the fourth registry), **MCP registry GA**.
