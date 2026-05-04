import { RequestError } from '@octokit/request-error';
import { Octokit } from '@octokit/rest';
import { debug, warn } from '@releasekit/core';
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
  cache: Map<number, PRContext>,
): Promise<void> {
  const octokit = new Octokit({ auth: token });
  const needed = issueNumbers.filter((n) => !cache.has(n));

  for (let i = 0; i < needed.length; i += FETCH_CONCURRENCY) {
    const batch = needed.slice(i, i + FETCH_CONCURRENCY);
    await Promise.all(
      batch.map(async (number) => {
        try {
          const { data } = await octokit.rest.issues.get({ owner, repo, issue_number: number });
          if (!data.pull_request) return;
          const raw = data.body ?? '';
          const body = truncateBody(sanitiseBody(raw));
          cache.set(number, { number, title: data.title, body });
        } catch (error) {
          if (error instanceof RequestError && (error.status === 401 || error.status === 403)) {
            warn(`GitHub API auth error fetching PR #${number} (${error.status}): check GITHUB_TOKEN permissions`);
          } else {
            debug(`Failed to fetch PR #${number}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }),
    );
  }
}

export function parseIssueNumbers(issueIds: string[]): number[] {
  return issueIds.map((id) => parseInt(id.replace(/^#/, ''), 10)).filter((n) => !isNaN(n) && n > 0);
}

export function resolveGitHubToken(): string | undefined {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;
}
