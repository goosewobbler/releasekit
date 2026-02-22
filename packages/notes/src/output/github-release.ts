import { Octokit } from '@octokit/rest';
import { info, success } from '@releasekit/core';
import type { TemplateContext } from '../core/types.js';
import { GitHubError } from '../errors/index.js';
import { renderMarkdown } from '../output/markdown.js';

export interface GitHubReleaseOptions {
  token?: string;
  owner: string;
  repo: string;
  draft?: boolean;
  prerelease?: boolean;
  generateNotes?: boolean;
}

export interface CreateReleaseResult {
  id: number;
  htmlUrl: string;
  tagName: string;
}

export class GitHubClient {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(options: GitHubReleaseOptions) {
    const token = options.token ?? process.env.GITHUB_TOKEN;

    if (!token) {
      throw new GitHubError('GITHUB_TOKEN not set. Set it as an environment variable.');
    }

    this.octokit = new Octokit({ auth: token });
    this.owner = options.owner;
    this.repo = options.repo;
  }

  async createRelease(
    context: TemplateContext,
    options: { draft?: boolean; prerelease?: boolean; generateNotes?: boolean } = {},
  ): Promise<CreateReleaseResult> {
    const tagName = `v${context.version}`;

    let body: string;

    if (context.enhanced?.releaseNotes) {
      body = context.enhanced.releaseNotes;
    } else {
      body = renderMarkdown([context]);
    }

    info(`Creating GitHub release for ${tagName}`);

    try {
      const response = await this.octokit.repos.createRelease({
        owner: this.owner,
        repo: this.repo,
        tag_name: tagName,
        name: tagName,
        body,
        draft: options.draft ?? false,
        prerelease: options.prerelease ?? false,
        generate_release_notes: options.generateNotes ?? false,
      });

      success(`Release created: ${response.data.html_url}`);

      return {
        id: response.data.id,
        htmlUrl: response.data.html_url,
        tagName,
      };
    } catch (error) {
      throw new GitHubError(`Failed to create release: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async updateRelease(
    releaseId: number,
    context: TemplateContext,
    options: { draft?: boolean; prerelease?: boolean } = {},
  ): Promise<CreateReleaseResult> {
    const tagName = `v${context.version}`;

    let body: string;

    if (context.enhanced?.releaseNotes) {
      body = context.enhanced.releaseNotes;
    } else {
      body = renderMarkdown([context]);
    }

    info(`Updating GitHub release ${releaseId}`);

    try {
      const response = await this.octokit.repos.updateRelease({
        owner: this.owner,
        repo: this.repo,
        release_id: releaseId,
        tag_name: tagName,
        name: tagName,
        body,
        draft: options.draft ?? false,
        prerelease: options.prerelease ?? false,
      });

      success(`Release updated: ${response.data.html_url}`);

      return {
        id: response.data.id,
        htmlUrl: response.data.html_url,
        tagName,
      };
    } catch (error) {
      throw new GitHubError(`Failed to update release: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getReleaseByTag(tag: string): Promise<CreateReleaseResult | null> {
    try {
      const response = await this.octokit.repos.getReleaseByTag({
        owner: this.owner,
        repo: this.repo,
        tag,
      });

      return {
        id: response.data.id,
        htmlUrl: response.data.html_url,
        tagName: response.data.tag_name,
      };
    } catch {
      return null;
    }
  }
}

export function parseRepoUrl(repoUrl: string): { owner: string; repo: string } | null {
  const patterns = [
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)/,
    /^git@github\.com:([^/]+)\/([^/]+)/,
    /^github\.com\/([^/]+)\/([^/]+)/,
  ];

  for (const pattern of patterns) {
    const match = repoUrl.match(pattern);
    if (match?.[1] && match[2]) {
      return {
        owner: match[1],
        repo: match[2].replace(/\.git$/, ''),
      };
    }
  }

  return null;
}

export async function createGitHubRelease(
  context: TemplateContext,
  options: GitHubReleaseOptions,
): Promise<CreateReleaseResult> {
  const client = new GitHubClient(options);
  return client.createRelease(context, options);
}
