import { info, success } from '@releasekit/core';
import { createGitHubForge, type Forge } from '@releasekit/forge';
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
  private forge: Forge;

  constructor(options: GitHubReleaseOptions, forge?: Forge) {
    const token = options.token ?? process.env.GITHUB_TOKEN;

    if (!token) {
      throw new GitHubError('GITHUB_TOKEN not set. Set it as an environment variable.');
    }

    this.forge = forge ?? createGitHubForge({ token, owner: options.owner, repo: options.repo });
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
      const ref = await this.forge.createRelease({
        tagName,
        name: tagName,
        body,
        draft: options.draft ?? false,
        prerelease: options.prerelease ?? false,
        generateReleaseNotes: options.generateNotes ?? false,
      });

      success(`Release created: ${ref.url}`);

      return {
        id: ref.id,
        htmlUrl: ref.url,
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
      const ref = await this.forge.updateRelease(releaseId, {
        tagName,
        name: tagName,
        body,
        draft: options.draft ?? false,
        prerelease: options.prerelease ?? false,
      });

      success(`Release updated: ${ref.url}`);

      return {
        id: ref.id,
        htmlUrl: ref.url,
        tagName,
      };
    } catch (error) {
      throw new GitHubError(`Failed to update release: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getReleaseByTag(tag: string): Promise<CreateReleaseResult | null> {
    const ref = await this.forge.getReleaseByTag(tag);
    return ref ? { id: ref.id, htmlUrl: ref.url, tagName: ref.tagName } : null;
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
