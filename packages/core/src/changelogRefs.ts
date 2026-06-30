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
 * Render the trailing issue/PR refs for a changelog entry per `mode`. Returns the comma-joined refs
 * WITHOUT any surrounding punctuation — callers wrap (the Markdown surface in `(…)`, the standing-PR
 * surface with a leading space). Returns `''` when there are no refs or `mode` is `'strip'`.
 *
 * `link` emits a canonical Markdown link `[#NNN](<repo>/issues/NNN)` — clickable, keeps the
 * hovercard, but no longer a bare token GitHub re-scans. It always points at `/issues/NNN`: GitHub
 * redirects issues↔pulls, so the emitter needn't know which. A non-GitHub / unparseable `repoUrl`
 * has no canonical URL to build, so `link` degrades to `escape` for that entry. `escape` renders a
 * literal `\#NNN` (no link, no hovercard); `strip` drops the refs entirely.
 *
 * Tokens may arrive as `#NNN` (the producer's format) or a bare `NNN`; the leading `#` is normalised.
 */
export function renderIssueRefs(issueIds: string[], mode: ChangelogRefsMode, repoUrl: string | null): string {
  if (mode === 'strip' || issueIds.length === 0) return '';

  const ownerRepo = mode === 'link' && repoUrl ? parseGitHubOwnerRepo(repoUrl) : null;

  return issueIds
    .map((raw) => {
      const num = raw.replace(/^#/, '');
      if (ownerRepo) {
        return `[#${num}](https://github.com/${ownerRepo.owner}/${ownerRepo.repo}/issues/${num})`;
      }
      // escape mode, or link mode with no resolvable GitHub repo → literal `#NNN`.
      return `\\#${num}`;
    })
    .join(', ');
}

// A GitHub mention is a word-boundary `@name` or `@org/team` (npm scoped package names share the
// `@scope/pkg` shape). Match those, but not when `@` is preceded by a word char, `/`, `@`, or `\`
// (a backslash means it's already escaped) — so emails (`foo@bar.com`) and mid-word `@` are left
// alone. An inline-code span is matched first and returned untouched: GitHub does not linkify a
// mention inside code, so escaping there would just surface a stray backslash.
const CODE_SPAN_OR_MENTION = /(`+)[\s\S]*?\1|(?<![0-9A-Za-z_@\\/])@[A-Za-z0-9][A-Za-z0-9-]*(?:\/[A-Za-z0-9._-]+)?/g;

/**
 * Backslash-escape `@`-mentions in changelog entry text so GitHub renders them as literal text with
 * no mention link (and never pings/subscribes a real user, org, or team on a release PR). Always
 * applied, independent of the `refs` mode. Conservative by design — only word-boundary mentions
 * outside inline code are touched.
 */
export function escapeChangelogMentions(text: string): string {
  return text.replace(CODE_SPAN_OR_MENTION, (match, codeTicks) => (codeTicks ? match : `\\${match}`));
}
