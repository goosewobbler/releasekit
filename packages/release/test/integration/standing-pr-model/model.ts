import { isBotComment } from '@releasekit/forge';
import semver from 'semver';
import { expect } from 'vitest';
import { parseManifest, type StandingPRResult } from '../../../src/standing-pr/standing-pr.js';
import { BOT, MAINTAINER, type PullRequest } from './forge.js';
import { PACKAGES, RELEASE_BRANCH, RELEASE_PREFIX, type World } from './world.js';

export interface Release {
  prNumber: number;
  mergeSha: string;
  /** Merged, but no publish job has run for it yet. */
  pending: boolean;
  /** Its last publish attempt failed or was refused. */
  failed: boolean;
}

export type Trigger = 'push' | 'schedule' | 'labeled' | 'unlabeled' | 'edited' | 'reconcile';

export interface UpdateRun {
  trigger: Trigger;
  /** The standing PR open when the run started. */
  openPr?: number;
  /** `pendingReleases` when the run started. */
  pending: Release[];
  result?: StandingPRResult;
}

/** What the commands know about the world, refreshed from it after each one. */
export interface Model {
  openPr?: number;
  releaseAtTip: boolean;
  releases: Release[];
  /** The release labels authorized actors applied to each standing PR. */
  approvedLabels: Map<number, Set<string>>;
  /** Commits that feeder PRs and the initial commit put on `main`; everything else is the release flow's. */
  nonReleaseShas: Set<string>;
  feeders: number;
  /** Which PR's publish job put each registry version there. */
  publishedBy: Map<string, number>;
  /** The update runs since the last invariant check. */
  updates: UpdateRun[];
}

export function initialModel(world: World): Model {
  return {
    releaseAtTip: false,
    releases: [],
    approvedLabels: new Map(),
    nonReleaseShas: new Set([world.mainSha()]),
    feeders: 0,
    publishedBy: new Map(),
    updates: [],
  };
}

export function pendingReleases(model: Readonly<Model>): Release[] {
  return model.releases.filter((r) => r.pending);
}

export function refresh(model: Model, world: World): void {
  model.openPr = world.forge.openStandingPr(RELEASE_BRANCH)?.number;
  model.releaseAtTip = !model.nonReleaseShas.has(world.mainSha());
  for (const pr of world.forge.prs.values()) {
    if (pr.head !== RELEASE_BRANCH) {
      continue;
    }
    if (!model.approvedLabels.has(pr.number)) {
      model.approvedLabels.set(pr.number, new Set());
    }
    if (pr.merged && !model.releases.some((r) => r.prNumber === pr.number)) {
      model.releases.push({ prNumber: pr.number, mergeSha: pr.mergeCommitSha as string, pending: true, failed: false });
    }
  }
}

function authorizedMerger(pr: PullRequest): boolean {
  return pr.mergedBy?.login === BOT.login || pr.mergedBy?.login === MAINTAINER.login;
}

function isAncestor(world: World, ancestor: string, descendant: string): boolean {
  try {
    world.git(world.origin, 'merge-base', '--is-ancestor', ancestor, descendant);
    return true;
  } catch {
    return false;
  }
}

function bumpedBy(world: World, mergeSha: string): Record<string, string> {
  const before = world.versionsAt(`${mergeSha}^`);
  const after = world.versionsAt(mergeSha);
  return Object.fromEntries(Object.entries(after).filter(([pkg, version]) => before[pkg] !== version));
}

export function assertInvariants(model: Model, world: World): void {
  const { forge, registry, config } = world;
  const main = world.mainSha();
  const mainVersions = world.versionsAt(main);

  for (const release of model.releases) {
    expect(isAncestor(world, release.mergeSha, main), `release #${release.prNumber}'s commit left main`).toBe(true);
    for (const [pkg, version] of Object.entries(world.versionsAt(release.mergeSha))) {
      expect(
        semver.gte(mainVersions[pkg] as string, version),
        `${pkg} on main went back below #${release.prNumber}'s`,
      ).toBe(true);
    }
  }

  const published = new Set(registry.read().published);
  for (const tag of world.remoteTags()) {
    const released = config.sync
      ? PACKAGES.map((pkg) => `${pkg}@${tag.slice(1)}`)
      : [`${tag.slice(0, tag.indexOf('@v'))}@${tag.slice(tag.indexOf('@v') + 2)}`];
    for (const spec of released) {
      expect(published.has(spec), `tag ${tag} was pushed, but ${spec} isn't published`).toBe(true);
    }
  }

  const republished = registry.read().attempts.filter((a) => a.outcome === 'conflict');
  expect(republished, 'a publish re-ran a published version').toEqual([]);

  for (const { sha, subject } of world.subjects('main')) {
    expect(subject.startsWith(RELEASE_PREFIX), `'${subject}'`).toBe(!model.nonReleaseShas.has(sha));
  }

  for (const { prNumber, body } of forge.manifestWrites) {
    expect(() => parseManifest(body), `a manifest written to #${prNumber} doesn't parse`).not.toThrow();
  }

  const markers = new Map<string, number>();
  for (const comment of forge.comments) {
    const end = comment.body.indexOf(' -->');
    const marker = comment.body.startsWith('<!-- ') && end !== -1 ? comment.body.slice(0, end + 4) : undefined;
    if (marker && isBotComment(comment)) {
      const key = `#${comment.prNumber} ${marker}`;
      markers.set(key, (markers.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of markers) {
    expect(count, `${key} was posted ${count} times`).toBe(1);
  }

  for (const [spec, prNumber] of model.publishedBy) {
    const pr = forge.prs.get(prNumber) as PullRequest;
    expect(pr.merged, `${spec} was published from #${prNumber}, which hasn't merged`).toBe(true);
    if (config.enforceMergeAuthor) {
      expect(authorizedMerger(pr), `${spec} was published from #${prNumber}, merged by ${pr.mergedBy?.login}`).toBe(
        true,
      );
    }
  }

  for (const [prNumber, approved] of model.approvedLabels) {
    const last = forge.manifestWrites.filter((w) => w.prNumber === prNumber).at(-1);
    const labels = last ? (parseManifest(last.body).overrideLabels ?? []) : [];
    expect(
      labels.filter((label) => !approved.has(label)),
      `#${prNumber}'s manifest approves labels no maintainer applied`,
    ).toEqual([]);
  }

  for (const run of model.updates) {
    const offered = run.result?.action === 'noop' ? [] : (run.result?.versionOutput?.updates ?? []);
    for (const release of run.pending) {
      const bumped = bumpedBy(world, release.mergeSha);
      for (const update of offered) {
        const untagged = bumped[update.packageName];
        expect(
          untagged === undefined || !semver.gt(update.newVersion, untagged),
          `an update offered ${update.packageName}@${update.newVersion} past #${release.prNumber}'s untagged ${untagged}`,
        ).toBe(true);
      }
    }
    if (run.openPr !== undefined && run.pending.length === 0 && !['push', 'reconcile'].includes(run.trigger)) {
      expect(run.result?.action ?? 'noop', `a ${run.trigger} run on open #${run.openPr} did nothing`).not.toBe('noop');
    }
  }
  model.updates = [];
}
