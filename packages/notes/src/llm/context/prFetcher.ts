import { debug, warn } from '@releasekit/core';
import { createGitHubForge, type Forge, forgeErrorStatus } from '@releasekit/forge';
import type { PRContext } from '../../core/types.js';

const BODY_CAP = 2048;

function stripHtmlComments(input: string): string {
  let result = '';
  let i = 0;
  while (i < input.length) {
    if (input.startsWith('<!--', i)) {
      const end = input.indexOf('-->', i + 4);
      i = end === -1 ? input.length : end + 3;
    } else {
      result += input[i++];
    }
  }
  return result;
}

function stripDetailsTags(input: string): string {
  let result = '';
  let i = 0;
  let depth = 0;
  const lower = input.toLowerCase();
  while (i < input.length) {
    if (lower.startsWith('<details', i)) {
      depth++;
      const tagEnd = lower.indexOf('>', i);
      i = tagEnd === -1 ? input.length : tagEnd + 1;
    } else if (lower.startsWith('</details>', i)) {
      if (depth > 0) depth--;
      i += 10;
    } else {
      if (depth === 0) result += input[i];
      i++;
    }
  }
  return result;
}

function sanitiseBody(raw: string): string {
  return stripDetailsTags(stripHtmlComments(raw))
    .replace(/!\[.*?\]\(.*?\)/g, '') // strip images
    .replace(/\n{3,}/g, '\n\n') // collapse blank lines
    .trim();
}

function truncateBody(body: string): string {
  if (body.length <= BODY_CAP) return body;

  // Prefer truncating at a heading boundary
  const headingPos = body.lastIndexOf('\n#', BODY_CAP);
  const cutAt = headingPos > BODY_CAP / 2 ? headingPos : BODY_CAP;
  return `${body.slice(0, cutAt).trimEnd()}\n…`;
}

const FETCH_CONCURRENCY = 5;

export async function fetchPullRequestContext(
  owner: string,
  repo: string,
  issueNumbers: number[],
  token: string,
  cache: Map<number, PRContext | null>,
  forge: Forge = createGitHubForge({ token, owner, repo }),
): Promise<void> {
  const needed = issueNumbers.filter((n) => !cache.has(n));

  for (let i = 0; i < needed.length; i += FETCH_CONCURRENCY) {
    const batch = needed.slice(i, i + FETCH_CONCURRENCY);
    await Promise.all(
      batch.map(async (number) => {
        try {
          const issue = await forge.getIssue(number);
          if (!issue.isPullRequest) {
            cache.set(number, null); // cache as "not a PR" to avoid re-fetching
            return;
          }
          const body = truncateBody(sanitiseBody(issue.body));
          cache.set(number, { number, title: issue.title, body });
        } catch (error) {
          const status = forgeErrorStatus(error);
          if (status === 401 || status === 403) {
            warn(`GitHub API auth error fetching PR #${number} (${status}): check GITHUB_TOKEN permissions`);
          } else if (status === 404) {
            cache.set(number, null); // not found — avoid re-fetching
          } else {
            debug(`Failed to fetch PR #${number}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }),
    );
  }
}

export function parseIssueNumbers(issueIds: string[]): number[] {
  return issueIds.map((id) => parseInt(id.replace(/^#/, ''), 10)).filter((n) => !Number.isNaN(n) && n > 0);
}

export function resolveGitHubToken(): string | undefined {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;
}
