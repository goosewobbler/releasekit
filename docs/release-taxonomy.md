# Release taxonomy: groups, prerequisites, and selection

When a monorepo grows past "every package moves together," three different questions start to
matter, and ReleaseKit answers each with a distinct mechanism. Keeping them separate is the whole
point — conflating "these must ship together" with "release just these now" is what makes other
tools' release config hard to reason about.

| | **Explicit group** | **Derived prerequisite** | **Selection** |
|---|---|---|---|
| Question | *"Which packages are coupled?"* | *"What else must ship for this to be coherent?"* | *"What do I want to release right now?"* |
| Source | **Declared** in `version.groups` | **Computed** from the dependency graph at release time | **Chosen** per release (labels / checkboxes / CLI) |
| Lifetime | Durable invariant | Re-derived every run | Ephemeral, one release |
| Coupling | Always — members move as a set | Only when a dependency actually changed | None — orthogonal to coupling |
| Bump | Per the group mode (shared or own) | Its **own** commit-driven bump | n/a (picks *which*, not *how much*) |

The rest of this page defines each notion, shows how to combine them, and walks two real consumer
repos. For the exact config keys see the [configuration reference](./configuration.md#versiongroups);
for the flags see the [CLI reference](./cli.md).

## Explicit groups — declared coupling

A **group** is a coordination invariant you declare once: a set of packages that release as a unit,
forever, regardless of what any single release happens to target. Three modes (full semantics in
[`version.groups`](./configuration.md#versiongroups)):

- **`fixed`** — any change in any member releases **all** members at one shared version. The global
  `version.sync: true` is exactly this over one implicit all-packages group.
- **`linked`** — only changed members release, but every releasing member shares the same computed
  version. Unchanged members stay put.
- **`independent`** — only changed members release, each on its **own** commit-driven version line
  (no shared version), but the set is **atomic**: targeting any member pulls in the whole group.

Reach for a group when the coupling is a *property of the packages* — a wire protocol spanning an
npm package and a Rust crate, a plugin that must match its host's ABI. The coupling is true on every
release, so it belongs in config, not in a label you have to remember to apply.

## Derived prerequisites — computed coupling

A **prerequisite** is not declared — it is *derived* from the workspace dependency graph at release
time. When you release package A and A transitively depends on B, and **B has also changed**, B is a
prerequisite of A: it must publish first so A resolves against a released version, not an unpublished
one.

Prerequisites are **opt-in per release**, because most of the time you want to release a leaf without
dragging its (unchanged) world along:

- CLI: `releasekit version --target A --include-prerequisites` (also on `release` and
  `standing-pr update`).
- Standing-PR label: [`release:with-prerequisites`](./configuration.md#cilabels) on the standing PR.

The override (a forced `bump:*` / channel) stays scoped to the **explicit** targets; each derived
prerequisite keeps its **own** commit-driven bump. An *unchanged* dependency is never pulled in —
there's nothing to release. Unlike a group, the set changes run to run as the graph and the commits
change.

## Selection — what to act on now

**Selection** answers "which packages this release," independent of how they're coupled or bumped.
It never invents coupling; it just narrows the set:

- **Scope labels** — `scope:<name>` on a feeder PR (standing-pr mode) or the standing PR itself,
  mapped to package patterns by [`ci.scopeLabels`](./configuration.md#ci). "Release the `auth`
  packages."
- **CLI targets** — `--target a,b` (or `--scope <name>` to resolve a configured scope) on `version`
  / `release`.
- **Standing-PR checkboxes** — the **Packages to release** task-list in the standing-PR body. Every
  changed package is ticked by default; untick one to hold it back from the next release. The choice
  is read back from the body (`<!-- rk-sel:… -->` markers, never the prose) and survives the PR
  being regenerated, so a held-back package stays held back until you re-tick it. A held-back
  package is excluded from the version step entirely — it is never bumped, so no orphaned version
  lands on `main` with no tag. (Requires the `pull_request: edited` trigger — see the
  [setup checklist](#setup-checklist).)

Selection composes with the other two: selecting one member of an atomic group still pulls in the
whole group (the invariant wins); selecting a target with `--include-prerequisites` still derives its
prerequisites. Unticking a package that is a prerequisite of a still-ticked target, or a member of an
`independent` group, surfaces a ⚠️ warning — you can do it, but you're told what you're splitting.
Members of a lockstep (`fixed`/`linked`) group can't be held back individually.

## Choosing between them

- The packages are **always** coupled → **group** (and pick the mode by whether they share a version
  line).
- You want a leaf release to drag in **whatever changed underneath it**, only when it changed →
  **prerequisites** (`--include-prerequisites` / `release:with-prerequisites`).
- You just want to **release a subset now** → **selection** (scope label, `--target`, or untick the
  rest in the standing PR).

They are orthogonal, so a single release routinely uses all three: select the `tauri` scope, whose
members form an `independent` group, with prerequisites pulled in for the one that changed.

## Real-repo examples

### wdio-desktop-mobile — mixed npm + Rust, per-package

[`webdriverio/desktop-mobile`](https://github.com/webdriverio/desktop-mobile) is a mixed **npm + Rust**
monorepo (Tauri/Dioxus crates with `Cargo.toml` alongside `@wdio/*` packages). It versions
**per-package** (`version.sync: false`, no groups) with `version.packageSpecificTags: true`, so each
package tags independently (`wdio-tauri-plugin@v1.1.0`). No coupling is declared because none is
needed: packages release on their own commit-driven cadence, and when a leaf depends on a changed
internal crate, `--include-prerequisites` pulls that crate in for the one release that needs it. This
is the baseline: **selection + prerequisites, no groups.**

### zubridge — standing-PR, a coupled npm + cargo pair

[`goosewobbler/zubridge`](https://github.com/goosewobbler/zubridge) runs in **standing-PR mode**,
mixed npm + cargo, `version.sync: false`. Its `@zubridge/tauri` (npm) and `tauri-plugin-zubridge`
(cargo) packages are coupled by a shared wire protocol: a protocol change must ship in both at once,
even though they live on **different version lines** (npm vs crate). That is exactly an
**`independent` group** — atomic, but no shared version. See the migration note below for moving
zubridge's existing `scope:tauri` selection label onto a declared group.

## Setup checklist

The primary path — declared groups for coupled families, scope labels for selection, checkboxes for
ad-hoc holds:

1. **Declare your coupled families** as groups in `releasekit.config.json`. Use `independent` for a
   contract-coupled set on separate version lines (npm + crate), `fixed`/`linked` for a shared
   version line:

   ```jsonc
   {
     "version": {
       "sync": false,
       "groups": {
         "tauri": { "packages": ["@zubridge/tauri", "tauri-plugin-zubridge"], "sync": "independent" }
       }
     }
   }
   ```

2. **Declare selection labels** for the subsets you release on demand, in `ci.scopeLabels`:

   ```jsonc
   { "ci": { "scopeLabels": { "scope:tauri": "@zubridge/tauri,tauri-plugin-zubridge" } } }
   ```

3. **Create the labels** in the repo: `releasekit labels sync` (or `--check` as a CI guard). This
   creates `scope:*`, `release:with-prerequisites`, and the rest of the canonical set.

4. **Enable standing-PR checkboxes** by adding the `edited` trigger and the bot-sender guard to your
   standing-pr workflow (so a tick/untick re-runs the update, and the bot's own body rewrite doesn't
   loop):

   ```yaml
   on:
     pull_request:
       types: [closed, labeled, unlabeled, edited]
   # in the update job's `if:` …
   #   github.event.sender.type != 'Bot'
   ```

   Full workflow in the [CI setup guide](../packages/release/docs/ci-setup.md).

## Migration: zubridge's `scope:tauri` → an `independent` group

zubridge originally expressed the tauri coupling as a **selection label** — `scope:tauri` mapped to
`@zubridge/tauri,tauri-plugin-zubridge`, applied whenever the pair needed releasing. That works, but
it puts a *durable invariant* (these two always ship together) into an *ephemeral* mechanism (a label
someone has to remember): nothing stops a release of one without the other.

Moving the coupling into a declared group makes it structural:

```jsonc
// before — coupling lives in a label you must remember to apply
{
  "ci": { "scopeLabels": { "scope:tauri": "@zubridge/tauri,tauri-plugin-zubridge" } }
}

// after — coupling is a declared invariant; the label (if kept) is pure selection
{
  "version": {
    "groups": {
      "tauri": { "packages": ["@zubridge/tauri", "tauri-plugin-zubridge"], "sync": "independent" }
    }
  },
  "ci": { "scopeLabels": { "scope:tauri": "@zubridge/tauri,tauri-plugin-zubridge" } }
}
```

What changes:

- **Atomicity is now guaranteed.** Targeting either member (by scope label, `--target`, or a commit
  that only touches one) expands to the whole group — you can no longer accidentally release
  `@zubridge/tauri` without `tauri-plugin-zubridge`.
- **Version lines are preserved.** `independent` keeps each on its own commit-driven version (npm at
  its line, the crate at its), exactly as today — unlike `fixed`/`linked`, which would force a shared
  version.
- **The `scope:tauri` label becomes optional, and purely selection.** Keep it as a convenient "act on
  the tauri family now" shortcut, or drop it — the group already guarantees they move together when
  either is released.

After editing config, run `releasekit labels sync` and (for checkbox selection) add the `edited`
trigger as above.
