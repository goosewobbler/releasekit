/**
 * Neutralising bare GitHub-autolinked tokens in changelog output. GitHub auto-links a bare `#NNN`
 * issue/PR ref (with a hovercard) and treats a bare `@scope/pkg` / `@user` as a mention (a stray
 * link that can ping/subscribe a real org or team on every release PR). Both render surfaces — the
 * notes Markdown (`CHANGELOG.md`, GitHub release body) and the standing-PR body — share these two
 * pure helpers so the treatment stays identical (#499).
 */

/** How bare `#NNN` issue/PR refs in a changelog are rendered. */
export type ChangelogRefsMode = 'strip' | 'escape' | 'link';

/**
 * Parse a GitHub repo URL into `{ owner, repo }`. Handles HTTPS
 * (`https://github.com/owner/repo[.git]`) and SCP-style SSH (`git@github.com:owner/repo[.git]`);
 * github.com only. Returns `null` for any other host or an unparseable input.
 */
export function parseGitHubOwnerRepo(repoUrl: string): { owner: string; repo: string } | null {
  const scpMatch = repoUrl.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (scpMatch) return { owner: scpMatch[1]!, repo: scpMatch[2]! };

  try {
    const url = new URL(repoUrl);
    if (url.hostname !== 'github.com') return null;
    const parts = url.pathname
      .replace(/^\//, '')
      .replace(/\.git$/, '')
      .split('/');
    if (parts.length >= 2 && parts[0] && parts[1]) return { owner: parts[0], repo: parts[1] };
  } catch {
    // not a parseable URL
  }
  return null;
}

/**
 * Render the trailing issue/PR refs for a changelog entry per `mode`. Returns the COMPLETE group
 * INCLUDING its own parentheses (e.g. `(PR #503 · closes #500)` or `(#503, #499)`); callers append it
 * after a single space. Returns `''` when there are no refs or `mode` is `'strip'`.
 *
 * In `link` mode with a resolvable GitHub `repoUrl` AND a known `prNumber`, the group distinguishes
 * the PR from the issues it closed: `(PR [#503](<repo>/pull/503) · closes [#500](<repo>/issues/500))`.
 * The PR link's visible text is `PR #503`, deliberately NOT a bare `#503`: GitHub auto-expands a bare
 * `#503` link into a rich inline reference card (merged-PR icon + the PR title) that duplicates the
 * entry; the `PR #503` text keeps a plain link plus the hovercard. The href is the canonical
 * `/pull/503` URL. `closes` is `issueIds` minus the PR (compared by numeric value); it is omitted when
 * empty, leaving `(PR #503)`.
 *
 * Otherwise it falls back to the plain ref list: canonical `[#NNN](<repo>/issues/NNN)` links in `link`
 * mode (issues↔pulls redirect, so the emitter needn't know which), or literal `\#NNN` in `escape` mode
 * and in `link` mode when `repoUrl` is non-GitHub / unparseable. The PR is never guessed — without
 * `prNumber` every ref renders the same. `strip` drops the refs entirely; `escape`/`strip` carry no
 * PR/closes labelling (it's a `link`-mode nicety).
 *
 * Tokens may arrive as `#NNN` (the producer's format) or a bare `NNN`; the leading `#` is normalised.
 */
export function renderIssueRefs(
  issueIds: string[],
  mode: ChangelogRefsMode,
  repoUrl: string | null,
  prNumber?: string,
): string {
  if (mode === 'strip') return '';
  const ids = issueIds ?? [];
  // prNumber is normally already in issueIds; fold it in defensively so no path can silently drop it.
  const allIds =
    prNumber && !ids.some((id) => Number(id.replace(/^#/, '')) === Number(prNumber.replace(/^#/, '')))
      ? [prNumber, ...ids]
      : ids;
  if (allIds.length === 0) return '';

  const ownerRepo = mode === 'link' && repoUrl ? parseGitHubOwnerRepo(repoUrl) : null;

  if (ownerRepo && prNumber) {
    const { owner, repo } = ownerRepo;
    const pr = prNumber.replace(/^#/, '');
    const prPart = `PR [#${pr}](https://github.com/${owner}/${repo}/pull/${pr})`;
    const closes = allIds.map((raw) => raw.replace(/^#/, '')).filter((num) => Number(num) !== Number(pr));
    if (closes.length === 0) return `(${prPart})`;
    const closesPart = closes.map((num) => `[#${num}](https://github.com/${owner}/${repo}/issues/${num})`).join(', ');
    return `(${prPart} · closes ${closesPart})`;
  }

  const rendered = allIds
    .map((raw) => {
      const num = raw.replace(/^#/, '');
      // escape mode, or link mode with no resolvable GitHub repo → literal `#NNN`.
      return ownerRepo
        ? `[#${num}](https://github.com/${ownerRepo.owner}/${ownerRepo.repo}/issues/${num})`
        : `\\#${num}`;
    })
    .join(', ');
  return rendered ? `(${rendered})` : '';
}

// A GitHub mention is a word-boundary `@name` or `@org/team` (npm scoped package names share the
// `@scope/pkg` shape). Match those, but not when `@` is preceded by a word char, `/`, `@`, or `\`
// (a backslash means it's already escaped) — so emails (`foo@bar.com`) and mid-word `@` are left
// alone. A (single-backtick) inline-code span is matched first and returned untouched: GitHub does
// not linkify a mention inside code, so escaping there would just surface a stray backslash.
//
// The code-span half deliberately matches only single-backtick spans (`` `[^`]*` ``) rather than a
// variable-length ```(`+)…\1```: the backreference form backtracks polynomially on adversarial
// backtick runs (ReDoS). Single backticks cover inline code in changelog text; a mention inside a
// rare multi-backtick span just gets a harmless literal backslash.
const CODE_SPAN_OR_MENTION = /`[^`]*`|(?<![0-9A-Za-z_@\\/])@[A-Za-z0-9][A-Za-z0-9-]*(?:\/[A-Za-z0-9._-]+)?/g;

/**
 * Backslash-escape `@`-mentions in changelog entry text so GitHub renders them as literal text with
 * no mention link (and never pings/subscribes a real user, org, or team on a release PR). Always
 * applied, independent of the `refs` mode. Conservative by design — only word-boundary mentions
 * outside inline code are touched.
 */
export function escapeChangelogMentions(text: string): string {
  // A code-span match starts with a backtick — leave it untouched; everything else is a mention.
  return text.replace(CODE_SPAN_OR_MENTION, (match) => (match.startsWith('`') ? match : `\\${match}`));
}
