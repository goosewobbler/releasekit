import { createHash } from 'node:crypto';
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
  isMonorepo?: boolean;
}

function cacheDir(): string {
  return path.join(os.tmpdir(), 'releasekit', 'examples');
}

function cacheKey(owner: string, repo: string, packageName: string): string {
  const safe = packageName.replace(/[^a-zA-Z0-9-]/g, '_');
  const hash = createHash('sha256').update(packageName).digest('hex').slice(0, 8);
  return path.join(cacheDir(), owner, repo, `${safe}_${hash}.json`);
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
  const { owner, repo, packageName, count, githubToken, isMonorepo } = options;

  if (count === 0) return [];

  const token = githubToken ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) {
    debug('No GitHub token available — skipping examples fetch');
    return [];
  }

  const octokit = new Octokit({ auth: token });

  try {
    const allReleases: Awaited<ReturnType<typeof octokit.rest.repos.listReleases>>['data'] = [];
    for (let page = 1; page <= 3; page++) {
      const { data } = await octokit.rest.repos.listReleases({ owner, repo, per_page: 100, page });
      allReleases.push(...data);
      const totalScoped = allReleases.filter(
        (r) => !r.draft && !r.prerelease && matchesPackageScoped(r.tag_name, packageName),
      ).length;
      if (totalScoped >= count || data.length < 100) break;
    }

    const nonDraft = allReleases.filter((r) => !r.draft && !r.prerelease);
    const packageScoped = nonDraft.filter((r) => matchesPackageScoped(r.tag_name, packageName));
    const matching = (
      packageScoped.length > 0
        ? packageScoped
        : isMonorepo
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
      return cached.slice(0, count);
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
