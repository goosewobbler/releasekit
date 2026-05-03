import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RequestError } from '@octokit/request-error';
import { Octokit } from '@octokit/rest';
import { debug, warn } from '@releasekit/core';
import { parseReleaseBodyToExample } from './parser.js';
import type { Example } from './types.js';

export interface FetchExamplesOptions {
  owner: string;
  repo: string;
  packageName: string;
  count: number;
  githubToken?: string;
}

function cacheDir(): string {
  return path.join(os.tmpdir(), 'releasekit', 'examples');
}

function cacheKey(owner: string, repo: string, packageName: string): string {
  const safe = packageName.replace(/[^a-zA-Z0-9-]/g, '_');
  return path.join(cacheDir(), `${owner}_${repo}_${safe}.json`);
}

interface CacheEntry {
  latestTag: string;
  examples: Example[];
}

function readCache(key: string, latestTag: string): Example[] | null {
  try {
    const raw = fs.readFileSync(key, 'utf-8');
    const entry: CacheEntry = JSON.parse(raw);
    return entry.latestTag === latestTag ? entry.examples : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, latestTag: string, examples: Example[]): void {
  try {
    fs.mkdirSync(path.dirname(key), { recursive: true });
    fs.writeFileSync(key, JSON.stringify({ latestTag, examples }), 'utf-8');
  } catch {
    // cache write failure is non-fatal
  }
}

function matchesPackageScoped(tagName: string, packageName: string): boolean {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}@`).test(tagName);
}

function matchesBareVersion(tagName: string): boolean {
  return /^v?\d/.test(tagName);
}

export async function fetchExamples(options: FetchExamplesOptions): Promise<Example[]> {
  const { owner, repo, packageName, count, githubToken } = options;

  if (count === 0) return [];

  const token = githubToken ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) {
    debug('No GitHub token available — skipping examples fetch');
    return [];
  }

  const octokit = new Octokit({ auth: token });

  try {
    const { data: releases } = await octokit.rest.repos.listReleases({
      owner,
      repo,
      per_page: Math.min(count * 10, 100),
    });

    const nonDraft = releases.filter((r) => !r.draft && !r.prerelease);
    const packageScoped = nonDraft.filter((r) => matchesPackageScoped(r.tag_name, packageName));
    // Only fall back to bare-version tags when the batch contains no package-scoped releases
    // at all — indicating a single-package repo. If other packages have scoped releases,
    // this package simply hasn't been released yet and bare tags would be misleading.
    const hasAnyPackageScoped = nonDraft.some((r) => r.tag_name.includes('@'));
    const matching = (
      packageScoped.length > 0
        ? packageScoped
        : hasAnyPackageScoped
          ? []
          : nonDraft.filter((r) => matchesBareVersion(r.tag_name))
    ).slice(0, count);

    if (matching.length === 0) {
      debug(`No matching releases found for ${packageName}`);
      return [];
    }

    const latestTag = matching[0]!.tag_name;
    const key = cacheKey(owner, repo, packageName);
    const cached = readCache(key, latestTag);
    if (cached) {
      debug(`Using cached examples for ${packageName} (tag: ${latestTag})`);
      return cached;
    }

    const examples: Example[] = [];
    for (const release of matching) {
      if (!release.body) continue;
      const version = release.tag_name.replace(/^.*@/, '').replace(/^v/, '');
      const example = parseReleaseBodyToExample(release.body, version);
      if (example) examples.push(example);
    }

    if (examples.length > 0) writeCache(key, latestTag, examples);
    debug(`Fetched ${examples.length} examples for ${packageName}`);
    return examples;
  } catch (error) {
    if (error instanceof RequestError && error.status === 403) {
      warn('GitHub API rate limit or auth error — skipping examples fetch');
    } else {
      debug(`Failed to fetch examples: ${error instanceof Error ? error.message : String(error)}`);
    }
    return [];
  }
}
