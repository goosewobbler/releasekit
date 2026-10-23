/* eslint-disable local/no-bare-issue-refs -- the #NNN below are examples of the reference format this module renders, not issue citations */

export type ChangelogRefsMode = 'strip' | 'escape' | 'link';

export function parseGitHubOwnerRepo(repoUrl: string): { owner: string; repo: string } | null {
  const [, scpOwner, scpRepo] = repoUrl.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/) ?? [];
  if (scpOwner && scpRepo) {
    return { owner: scpOwner, repo: scpRepo };
  }

  try {
    const url = new URL(repoUrl);
    if (url.hostname !== 'github.com') {
      return null;
    }
    const parts = url.pathname
      .replace(/^\//, '')
      .replace(/\.git$/, '')
      .split('/');
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return { owner: parts[0], repo: parts[1] };
    }
  } catch {
    // not a parseable URL
  }
  return null;
}

/**
 * Returns the whole group including its parentheses, e.g. `(PR #503 · closes #500)`, for callers to append after a
 * single space, or `''` when there's nothing to render.
 */
export function renderIssueRefs(
  issueIds: string[],
  mode: ChangelogRefsMode,
  repoUrl: string | null,
  prNumber?: string,
): string {
  if (mode === 'strip') {
    return '';
  }
  const ids = issueIds ?? [];
  // prNumber is normally already in issueIds; fold it in defensively so no path can silently drop it.
  const allIds =
    prNumber && !ids.some((id) => Number(id.replace(/^#/, '')) === Number(prNumber.replace(/^#/, '')))
      ? [prNumber, ...ids]
      : ids;
  if (allIds.length === 0) {
    return '';
  }

  const ownerRepo = mode === 'link' && repoUrl ? parseGitHubOwnerRepo(repoUrl) : null;

  if (ownerRepo && prNumber) {
    const { owner, repo } = ownerRepo;
    const pr = prNumber.replace(/^#/, '');
    // `PR #503`, not a bare `#503`: GitHub expands a bare PR link into an inline card that duplicates the entry.
    const prPart = `PR [#${pr}](https://github.com/${owner}/${repo}/pull/${pr})`;
    const closes = allIds.map((raw) => raw.replace(/^#/, '')).filter((num) => Number(num) !== Number(pr));
    if (closes.length === 0) {
      return `(${prPart})`;
    }
    const closesPart = closes.map((num) => `[#${num}](https://github.com/${owner}/${repo}/issues/${num})`).join(', ');
    return `(${prPart} · closes ${closesPart})`;
  }

  const rendered = allIds
    .map((raw) => {
      const num = raw.replace(/^#/, '');
      // `/issues/N` redirects to the PR when N is one, so refs needn't be told apart.
      return ownerRepo
        ? `[#${num}](https://github.com/${ownerRepo.owner}/${ownerRepo.repo}/issues/${num})`
        : `\\#${num}`;
    })
    .join(', ');
  return rendered ? `(${rendered})` : '';
}

// A mention is a word-boundary `@name` or `@org/team`, which scoped package names also match. The lookbehind skips
// emails, mid-word `@` and an already-escaped `\@`. Inline-code spans are matched first and left alone, since GitHub
// doesn't linkify a mention inside code. Only single-backtick spans: the variable-length ```(`+)…\1``` form
// backtracks polynomially on adversarial backtick runs (ReDoS), and a mention in a rare multi-backtick span just gets
// a harmless backslash.
const CODE_SPAN_OR_MENTION = /`[^`]*`|(?<![0-9A-Za-z_@\\/])@[A-Za-z0-9][A-Za-z0-9-]*(?:\/[A-Za-z0-9._-]+)?/g;

/** Unescaped, GitHub turns these into mentions that ping or subscribe a real user, org or team. */
export function escapeChangelogMentions(text: string): string {
  return text.replace(CODE_SPAN_OR_MENTION, (match) => (match.startsWith('`') ? match : `\\${match}`));
}

// A parenthesised `(#123)` or a bare `#123` at a word boundary, but not one already escaped (`\#`), a markdown link
// (`[#123]`) or part of a `/`-path. One optional leading space is captured so a removed ref doesn't leave a double
// space (bounded `( ?)`, not `(\s*)`, to avoid polynomial backtracking). Inline-code spans are skipped as in the
// mention regex.
const CODE_SPAN_OR_DESC_REF = /`[^`]*`|( ?)(?:\(#(\d+)\)|(?<![\\[/\w])#(\d+)\b)/g;

/**
 * Description refs come from the squash commit subject, and GitHub would otherwise auto-link them into verbose
 * hovercards. A ref also in `appendedRefs` (the appended `(PR … · closes …)` label) is removed as a duplicate.
 */
export function neutralizeDescriptionRefs(
  text: string,
  appendedRefs: Array<string | undefined>,
  mode: ChangelogRefsMode,
  repoUrl: string | null,
): string {
  const appended = new Set(appendedRefs.filter((r): r is string => !!r).map((r) => Number(r.replace(/^#/, ''))));
  const ownerRepo = mode === 'link' && repoUrl ? parseGitHubOwnerRepo(repoUrl) : null;
  const out = text.replace(
    CODE_SPAN_OR_DESC_REF,
    (match, lead: string | undefined, parenNum?: string, bareNum?: string) => {
      const num = parenNum ?? bareNum;
      if (num === undefined) {
        return match; // inline-code span
      }
      const ws = lead ?? '';
      if (appended.has(Number(num)) || mode === 'strip') {
        return '';
      }
      const inner = ownerRepo
        ? `[#${num}](https://github.com/${ownerRepo.owner}/${ownerRepo.repo}/issues/${num})`
        : `\\#${num}`;
      return parenNum !== undefined ? `${ws}(${inner})` : `${ws}${inner}`;
    },
  );
  // `( ?)` only eats the space before a ref, so one removed from the very start leaves the following space behind.
  return out.trim();
}
