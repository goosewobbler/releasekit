# 1. ReleaseKit remains a TypeScript codebase

Date: 2026-07-19

## Status

Accepted.

## Context

Several tools in releasekit's competitive set are written in Rust — release-plz, knope, git-cliff, and sampo (which ships a Rust core distributed to npm consumers via platform-specific binary packages). This recurringly raises the question of whether releasekit should adopt a Rust core behind bindings, or be rewritten outright, while it is still pre-1.0 and the surface is small enough to move.

A dedicated investigation (July 2026) weighed stay-TypeScript against a napi-rs hybrid core, a WASM core, and a full rewrite. The salient findings:

- **The workload is IO/subprocess-bound, not CPU-bound.** releasekit orchestrates git, the GitHub API, registry CLIs, and LLM calls. Node startup and JS execution are noise against multi-second network and subprocess operations. The rewrites that justify themselves — Biome, oxc, rolldown, the TypeScript-Go port — are all CPU-bound over large inputs. Turborepo's Go→Rust migration, the closest "tooling not compiler" analogue, was motivated by team/codebase alignment with a sibling Rust project, not performance. Neither rationale transfers.
- **A Rust core would not remove the Node requirement.** Publishing npm packages requires the npm CLI (hence Node) regardless of releasekit's language; the GitHub Action runs on runners with Node preinstalled. Sampo — the exact pattern that would be copied — still declares `engines: { node: ">=22" }` on its npm wrapper. The only genuinely Node-free segment (pure-Rust/Dart repos publishing to the GitHub-hosted Action) is already served by knope and release-plz, and in Actions the objection is moot.
- **The LLM-notes differentiator depends on official SDKs that do not exist in Rust.** Anthropic ships official SDKs for Python/TypeScript/others but not Rust; community crates are thin, low-adoption wrappers that lag API features. Rewriting would move the tool's clearest advantage onto unofficial dependencies.
- **A rewrite breaks user-facing surfaces.** Consumer release-notes templates support three JS engines including EJS (arbitrary embedded JS — unimplementable outside a JS runtime); the `VersionOutput` contract is persisted inside standing-PR manifests in open PRs and would need byte-compatible reproduction from any new core.
- **Solo + AI-agent velocity is the scarcest resource and is TypeScript-anchored.** The test estate, mock-harness conventions, the Zod→schema→docs pipeline, and the agent context that makes `status:agent-ready` issues workable are all TypeScript. A rewrite resets that context during exactly the window feature velocity compounds.

## Decision

ReleaseKit stays pure TypeScript. No Rust core, no rewrite, for the foreseeable future.

Two hedges keep the door open cheaply:

- The `VersionOutput` contract and the `Forge` interface stay language-agnostic (they already are — serialized JSON and an interface), so a future extracted core has a clean seam.
- If single-binary / Node-free distribution demand ever materialises, it is probed first with Node SEA or `bun build --compile` of the existing TypeScript — a packaging change, never a language decision.

## Consequences

- Feature work (LLM notes depth, standing-PR ergonomics, trusted publishing) proceeds without a parity-rewrite tax.
- releasekit accepts a cosmetic positioning gap against Rust-native competitors ("not a single binary"), judged not to affect its actual Node-having audience.
- **Reconsider-triggers** (any one warrants revisiting): a profiled CPU-bound hotspot on a real monorepo; an official Anthropic Rust SDK *and* adoption evidence that the Node requirement blocks users; or a multi-maintainer team that changes the velocity calculus. If a hybrid is ever justified, the first extraction candidate is `packages/version` bump calculation behind the existing JSON seam via napi-rs (never UniFFI, which targets mobile bindings).
