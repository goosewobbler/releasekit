import fc from 'fast-check';
import {
  parseManifest,
  runStandingPRMerge,
  runStandingPRPublish,
  runStandingPRUpdate,
  type StandingPROptions,
  serializeManifest,
} from '../../../src/standing-pr/standing-pr.js';
import { type Actor, BOT, MAINTAINER, type PullRequest, WRITER } from './forge.js';
import {
  assertInvariants,
  type Model,
  pendingReleases,
  type Release,
  refresh,
  type Trigger,
  type UpdateRun,
} from './model.js';
import { type JobEnv, PACKAGES, type PackageName, RELEASE_BRANCH, type World } from './world.js';

const RELEASE_LABELS = ['bump:minor', 'bump:major', 'channel:prerelease'];

function options(dir: string): StandingPROptions {
  return { projectDir: dir, verbose: false, quiet: true, json: false };
}

/** A failed job is allowed; what it leaves behind is what the invariants judge. */
async function attempt<T>(world: World, what: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    world.log.push(`${what} failed: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

function prPayload(world: World, pr: PullRequest): object {
  return {
    number: pr.number,
    state: pr.state,
    merged: pr.merged,
    head: { ref: pr.head, sha: world.forge.headSha(pr) },
    base: { ref: pr.base },
    merge_commit_sha: pr.mergeCommitSha ?? null,
    merged_by: pr.mergedBy ?? null,
    labels: pr.labels.map((name) => ({ name })),
  };
}

async function update(model: Model, world: World, trigger: Trigger, env: Omit<JobEnv, 'sha'>): Promise<void> {
  const run: UpdateRun = {
    trigger,
    openPr: model.openPr,
    pending: pendingReleases(model).map((r) => ({ ...r })),
  };
  model.updates.push(run);
  const sha = world.mainSha();
  const dir = world.checkout(sha);
  run.result = await attempt(world, `update (${trigger})`, () =>
    world.job(dir, { ...env, sha }, () => runStandingPRUpdate(options(dir))),
  );
}

function prEvent(world: World, pr: PullRequest, action: string, sender: Actor, extra: object = {}) {
  return {
    eventName: 'pull_request',
    event: { action, sender, pull_request: prPayload(world, pr), ...extra },
    ref: `refs/pull/${pr.number}/merge`,
  };
}

async function publish(
  model: Model,
  world: World,
  prNumber: number,
  dir: string,
  env: JobEnv,
  explicit: boolean,
): Promise<boolean> {
  const before = new Set(world.registry.read().published);
  const result = await attempt(world, `publish #${prNumber}`, () =>
    world.job(dir, env, () => runStandingPRPublish(options(dir), explicit ? prNumber : undefined)),
  );
  world.registry.failAfter(null);
  for (const spec of world.registry.read().published) {
    if (!before.has(spec)) {
      model.publishedBy.set(spec, prNumber);
    }
  }
  return result !== undefined;
}

/** A pending release with a feeder commit on top: an update now sees its bump before its tags. */
function untaggedBelowTip(model: Readonly<Model>): boolean {
  return pendingReleases(model).length > 0 && !model.releaseAtTip;
}

function canRunOnOpenPr(model: Readonly<Model>): boolean {
  return model.openPr !== undefined;
}

export abstract class Command implements fc.AsyncCommand<Model, World> {
  abstract check(model: Readonly<Model>): boolean;
  abstract apply(model: Model, world: World): Promise<void>;
  abstract toString(): string;

  async run(model: Model, world: World): Promise<void> {
    world.tick();
    await this.apply(model, world);
    world.park();
    refresh(model, world);
    assertInvariants(model, world);
  }
}

export class MergeFeeder extends Command {
  constructor(
    private readonly type: 'fix' | 'feat' | 'feat!',
    private readonly packages: PackageName[],
  ) {
    super();
  }
  check(): boolean {
    return true;
  }
  async apply(model: Model, world: World): Promise<void> {
    const n = ++model.feeders;
    const subject = `${this.type}: change ${n}`;
    const files = Object.fromEntries(this.packages.map((pkg) => [`packages/${pkg}/src/${n}.js`, `// ${n}\n`]));
    const sha = world.commitToMain(subject, files);
    model.nonReleaseShas.add(sha);
    world.forge.recordMergedFeeder(subject, [], sha);
  }
  toString(): string {
    return `merge feeder '${this.type}' touching ${this.packages.join(', ')}`;
  }
}

export class Update extends Command {
  constructor(private readonly trigger: 'push' | 'schedule') {
    super();
  }
  check(model: Readonly<Model>): boolean {
    return !untaggedBelowTip(model);
  }
  async apply(model: Model, world: World): Promise<void> {
    await update(model, world, this.trigger, { eventName: this.trigger, event: {} });
  }
  toString(): string {
    return `${this.trigger} update`;
  }
}

export class Label extends Command {
  constructor(
    private readonly actor: Actor,
    private readonly label: string,
    private readonly add: boolean,
  ) {
    super();
  }
  check(model: Readonly<Model>): boolean {
    return canRunOnOpenPr(model);
  }
  async apply(model: Model, world: World): Promise<void> {
    const pr = world.forge.prs.get(model.openPr as number) as PullRequest;
    if (pr.labels.includes(this.label) === this.add) {
      return;
    }
    pr.labels = this.add ? [...pr.labels, this.label] : pr.labels.filter((l) => l !== this.label);
    if (this.actor === MAINTAINER) {
      const approved = model.approvedLabels.get(pr.number) ?? new Set();
      if (this.add) {
        approved.add(this.label);
      } else {
        approved.delete(this.label);
      }
      model.approvedLabels.set(pr.number, approved);
    }
    const action = this.add ? 'labeled' : 'unlabeled';
    await update(model, world, action, prEvent(world, pr, action, this.actor, { label: { name: this.label } }));
  }
  toString(): string {
    return `${this.actor.login} ${this.add ? 'adds' : 'removes'} '${this.label}'`;
  }
}

export class ToggleSelection extends Command {
  constructor(
    private readonly actor: Actor,
    private readonly pkg: PackageName,
  ) {
    super();
  }
  check(model: Readonly<Model>): boolean {
    return canRunOnOpenPr(model);
  }
  async apply(model: Model, world: World): Promise<void> {
    const pr = world.forge.prs.get(model.openPr as number) as PullRequest;
    const marker = `<!-- rk-sel:${this.pkg} -->`;
    const lines = pr.body.split('\n');
    const row = lines.findIndex((line) => line.includes(marker) && /^\s*- \[[ xX]\]/.test(line));
    if (row === -1) {
      return;
    }
    const from = pr.body;
    const line = lines[row] as string;
    lines[row] = line.includes('- [ ]') ? line.replace('- [ ]', '- [x]') : line.replace(/- \[[xX]\]/, '- [ ]');
    world.forge.editBody(pr.number, this.actor, lines.join('\n'));
    await update(model, world, 'edited', prEvent(world, pr, 'edited', this.actor, { changes: { body: { from } } }));
  }
  toString(): string {
    return `${this.actor.login} toggles ${this.pkg}'s selection row`;
  }
}

export class Merge extends Command {
  constructor(private readonly actor: Actor) {
    super();
  }
  check(model: Readonly<Model>): boolean {
    return model.openPr !== undefined;
  }
  async apply(model: Model, world: World): Promise<void> {
    const prNumber = model.openPr as number;
    if (this.actor === BOT) {
      const sha = world.mainSha();
      const dir = world.checkout(sha);
      await attempt(world, 'standing-pr merge', () =>
        world.job(dir, { eventName: 'workflow_dispatch', event: { sender: MAINTAINER }, sha }, () =>
          runStandingPRMerge(options(dir)),
        ),
      );
    } else {
      await attempt(world, `merge by ${this.actor.login}`, async () => world.forge.mergeAs(prNumber, this.actor));
    }
  }
  toString(): string {
    return this.actor === BOT ? 'standing-pr merge' : `${this.actor.login} merges in the UI`;
  }
}

export class MergeMidUpdate extends Command {
  constructor(private readonly actor: Actor) {
    super();
  }
  check(model: Readonly<Model>): boolean {
    return canRunOnOpenPr(model);
  }
  async apply(model: Model, world: World): Promise<void> {
    world.forge.beforeManifestUpsert = async (prNumber) => {
      world.tick();
      world.forge.mergeAs(prNumber, this.actor);
    };
    try {
      await update(model, world, 'push', { eventName: 'push', event: {} });
    } finally {
      world.forge.beforeManifestUpsert = undefined;
    }
  }
  toString(): string {
    return `push update, during which ${this.actor.login} merges before the manifest lands`;
  }
}

/** The publish job of the oldest merged, unpublished standing PR, ending with its reconcile. */
export class Publish extends Command {
  constructor(private readonly failAfter: number | null) {
    super();
  }
  check(model: Readonly<Model>): boolean {
    return pendingReleases(model).length > 0;
  }
  async apply(model: Model, world: World): Promise<void> {
    const release = pendingReleases(model)[0] as Release;
    const pr = world.forge.prs.get(release.prNumber) as PullRequest;
    world.registry.failAfter(this.failAfter);
    const dir = world.checkout(release.mergeSha);
    const env = { ...prEvent(world, pr, 'closed', pr.mergedBy ?? BOT), ref: 'refs/heads/main', sha: release.mergeSha };
    const ok = await publish(model, world, pr.number, dir, env, false);
    release.pending = false;
    release.failed = !ok;
    if (ok) {
      const run: UpdateRun = { trigger: 'reconcile', openPr: model.openPr, pending: pendingReleases(model) };
      model.updates.push(run);
      run.result = await attempt(world, 'reconcile', () =>
        world.job(dir, env, () => runStandingPRUpdate({ ...options(dir), reconcile: true })),
      );
    }
  }
  toString(): string {
    return this.failAfter === null ? 'publish' : `publish, failing after ${this.failAfter} package(s)`;
  }
}

/** `release:retry` on the latest failed release, which publishes from `main`'s tip. */
export class Retry extends Command {
  constructor(private readonly failAfter: number | null) {
    super();
  }
  check(model: Readonly<Model>): boolean {
    return model.releases.some((r) => r.failed);
  }
  async apply(model: Model, world: World): Promise<void> {
    const release = model.releases.filter((r) => r.failed).at(-1) as Release;
    const pr = world.forge.prs.get(release.prNumber) as PullRequest;
    world.registry.failAfter(this.failAfter);
    const sha = world.mainSha();
    const dir = world.checkout(sha);
    const env = {
      ...prEvent(world, pr, 'labeled', MAINTAINER, { label: { name: 'release:retry' } }),
      ref: 'refs/heads/main',
      sha,
    };
    release.failed = !(await publish(model, world, pr.number, dir, env, true));
  }
  toString(): string {
    return this.failAfter === null ? 'retry' : `retry, failing after ${this.failAfter} package(s)`;
  }
}

export class UpdateAtReleaseTip extends Command {
  constructor(private readonly trigger: 'schedule' | 'labeled') {
    super();
  }
  check(model: Readonly<Model>): boolean {
    return model.openPr !== undefined && model.releaseAtTip && pendingReleases(model).length === 0;
  }
  async apply(model: Model, world: World): Promise<void> {
    if (this.trigger === 'schedule') {
      await update(model, world, 'schedule', { eventName: 'schedule', event: {} });
      return;
    }
    await new Label(MAINTAINER, 'bump:minor', true).apply(model, world);
  }
  toString(): string {
    return `${this.trigger === 'schedule' ? 'schedule update' : "maintainer adds 'bump:minor'"} with a release commit at main's tip`;
  }
}

export class UpdatePastUntaggedRelease extends Command {
  check(model: Readonly<Model>): boolean {
    return untaggedBelowTip(model);
  }
  async apply(model: Model, world: World): Promise<void> {
    await update(model, world, 'push', { eventName: 'push', event: {} });
  }
  toString(): string {
    return 'push update above an untagged release';
  }
}

export class PublishOpenPr extends Command {
  check(model: Readonly<Model>): boolean {
    return model.openPr !== undefined;
  }
  async apply(model: Model, world: World): Promise<void> {
    const prNumber = model.openPr as number;
    const sha = world.branchSha(RELEASE_BRANCH) as string;
    const dir = world.checkout(sha, RELEASE_BRANCH);
    const env = { eventName: 'workflow_dispatch', event: { sender: WRITER }, ref: `refs/heads/${RELEASE_BRANCH}`, sha };
    await publish(model, world, prNumber, dir, env, true);
  }
  toString(): string {
    return 'dispatch standing-pr publish --pr <open standing PR>';
  }
}

export class EditManifest extends Command {
  check(model: Readonly<Model>): boolean {
    return canRunOnOpenPr(model);
  }
  async apply(model: Model, world: World): Promise<void> {
    const comment = await world.forge.findComment(model.openPr as number, '<!-- releasekit-manifest -->');
    if (!comment) {
      return;
    }
    const manifest = parseManifest(comment.body);
    manifest.overrideLabels = [...new Set([...(manifest.overrideLabels ?? []), 'bump:major'])].sort();
    world.forge.editCommentAs(comment.id, serializeManifest(manifest), WRITER);
    world.forge.labelEventsUnreadable = true;
    try {
      await new Label(WRITER, 'bump:major', true).apply(model, world);
    } finally {
      world.forge.labelEventsUnreadable = false;
    }
  }
  toString(): string {
    return "writer edits the manifest to approve 'bump:major', then adds it while the label timeline can't be read";
  }
}

const actors = fc.constantFrom(MAINTAINER, WRITER);
const failAfter = fc.constantFrom(null, 0, 1);

/**
 * `knownBug` disables a command that reaches an open bug. The fix turns it back on and adds a regression test from
 * the sequence it fails. `weight` repeats a command that most others depend on.
 */
export const COMMANDS: Array<{ arbitrary: fc.Arbitrary<Command>; weight?: number; knownBug?: string }> = [
  {
    weight: 3,
    arbitrary: fc
      .tuple(
        fc.constantFrom<'fix' | 'feat' | 'feat!'>('fix', 'feat', 'feat!'),
        fc.subarray([...PACKAGES], { minLength: 1 }),
      )
      .map(([type, packages]) => new MergeFeeder(type, packages)),
  },
  {
    weight: 2,
    arbitrary: fc.constantFrom<'push' | 'schedule'>('push', 'schedule').map((trigger) => new Update(trigger)),
  },
  {
    arbitrary: fc
      .tuple(actors, fc.constantFrom(...RELEASE_LABELS), fc.boolean())
      .map(([actor, label, add]) => new Label(actor, label, add)),
  },
  {
    arbitrary: fc.tuple(actors, fc.constantFrom(...PACKAGES)).map(([actor, pkg]) => new ToggleSelection(actor, pkg)),
  },
  { weight: 2, arbitrary: fc.constantFrom(MAINTAINER, WRITER, BOT).map((actor) => new Merge(actor)) },
  { arbitrary: actors.map((actor) => new MergeMidUpdate(actor)) },
  { weight: 2, arbitrary: failAfter.map((n) => new Publish(n)) },
  { arbitrary: failAfter.map((n) => new Retry(n)) },
  { arbitrary: fc.constant(new UpdatePastUntaggedRelease()) },
  {
    arbitrary: fc
      .constantFrom<'schedule' | 'labeled'>('schedule', 'labeled')
      .map((trigger) => new UpdateAtReleaseTip(trigger)),
  },
  { arbitrary: fc.constant(new PublishOpenPr()) },
  { arbitrary: fc.constant(new EditManifest()) },
];

export function commandArbitraries(enabledBugs: ReadonlySet<string>): Array<fc.Arbitrary<Command>> {
  return COMMANDS.filter((c) => !c.knownBug || enabledBugs.has(c.knownBug)).flatMap((c) =>
    Array<fc.Arbitrary<Command>>(c.weight ?? 1).fill(c.arbitrary),
  );
}
