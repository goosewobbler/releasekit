import * as fs from 'node:fs';

export interface PreviewContext {
  prNumber: number;
  owner: string;
  repo: string;
  token: string;
}

/**
 * Resolve PR context from CLI flags or GitHub Actions environment variables.
 */
export function resolvePreviewContext(opts: { pr?: string; repo?: string }): PreviewContext {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable is required');
  }

  const prNumber = resolvePRNumber(opts.pr);
  const { owner, repo } = resolveRepo(opts.repo);

  return { prNumber, owner, repo, token };
}

function resolvePRNumber(cliValue?: string): number {
  if (cliValue) {
    const num = Number.parseInt(cliValue, 10);
    if (Number.isNaN(num) || num <= 0) {
      throw new Error(`Invalid PR number: ${cliValue}`);
    }
    return num;
  }

  // Auto-detect from GitHub Actions event payload
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && fs.existsSync(eventPath)) {
    try {
      const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
      if (event.pull_request?.number) {
        return event.pull_request.number;
      }
    } catch {
      // Ignore malformed JSON and fall through to error
    }
  }

  throw new Error('Could not determine PR number. Use --pr <number> or run in a GitHub Actions pull_request workflow.');
}

function resolveRepo(cliValue?: string): { owner: string; repo: string } {
  const repoStr = cliValue ?? process.env.GITHUB_REPOSITORY;
  if (!repoStr) {
    throw new Error('Could not determine repository. Use --repo <owner/repo> or run in a GitHub Actions workflow.');
  }

  const parts = repoStr.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repository format: ${repoStr}. Expected "owner/repo".`);
  }

  return { owner: parts[0], repo: parts[1] };
}
