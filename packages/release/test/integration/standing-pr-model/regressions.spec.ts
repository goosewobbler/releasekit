import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseManifest } from '../../../src/standing-pr/standing-pr.js';
import {
  type Command,
  EditManifest,
  ImmediateRelease,
  Merge,
  MergeFeeder,
  Publish,
  PublishOpenPr,
  ToggleSelection,
  Update,
  UpdateAtReleaseTip,
  UpdatePastUntaggedRelease,
} from './commands.js';
import { MAINTAINER, type StatefulForge } from './forge.js';
import { initialModel, refresh } from './model.js';
import { isolateJobEnv, RELEASE_BRANCH, World } from './world.js';

const current = vi.hoisted(() => ({ forge: undefined as StatefulForge | undefined }));
vi.mock('../../../src/github.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/github.js')>()),
  forgeFor: () => current.forge,
}));

isolateJobEnv();

let world: World | undefined;

afterEach(() => {
  world?.dispose();
  world = undefined;
});

async function runSequence(w: World, commands: Command[], model = initialModel(w)) {
  refresh(model, w);
  for (const command of commands) {
    expect(command.check(model), `${command} can't run here`).toBe(true);
    await command.run(model, w);
  }
  return model;
}

describe('standing-PR model regressions', () => {
  it('should refuse a dispatched publish of the still-open standing PR', async () => {
    world = World.create({ sync: true, enforceMergeAuthor: false });
    current.forge = world.forge;

    const model = await runSequence(world, [new MergeFeeder('fix', ['rk-a']), new Update('push'), new PublishOpenPr()]);

    expect(model.publishedBy).toEqual(new Map());
    expect(world.log).toEqual([
      expect.stringMatching(/^publish #\d+ failed: Refusing to publish PR #\d+: it has not merged/),
    ]);
  }, 120_000);

  it('should wait out an untagged release instead of offering a version past it', async () => {
    world = World.create({ sync: true, enforceMergeAuthor: false });
    current.forge = world.forge;

    const model = await runSequence(world, [
      new MergeFeeder('fix', ['rk-a']),
      new Update('push'),
      new Merge(MAINTAINER),
      new MergeFeeder('fix', ['rk-a']),
      new UpdatePastUntaggedRelease(),
    ]);
    expect(world.forge.openStandingPr(RELEASE_BRANCH)).toBeUndefined();

    // A run at main's tip, above the feeder, still builds and tags the release at its merge commit.
    const mergeSha = model.releases[0]?.mergeSha;
    await runSequence(world, [new Publish(null)], model);
    expect([...model.publishedBy.keys()].sort()).toEqual(['rk-a@1.0.1', 'rk-b@1.0.1']);
    const { builtAt } = world.registry.read();
    expect([builtAt['rk-a@1.0.1'], builtAt['rk-b@1.0.1']]).toEqual([mergeSha, mergeSha]);
    expect(world.git(world.origin, 'rev-list', '-n', '1', 'v1.0.1')).toBe(mergeSha);
    const next = parseManifest(world.forge.manifestWrites.at(-1)?.body ?? '');
    expect(new Set(next.versionOutput.updates.map((u) => u.newVersion))).toEqual(new Set(['1.0.2']));
  }, 120_000);

  it('should publish an untagged standing release from its merge commit, then an immediate release from the tip', async () => {
    world = World.create({ sync: true, enforceMergeAuthor: false });
    current.forge = world.forge;

    const model = await runSequence(world, [
      new MergeFeeder('fix', ['rk-a']),
      new Update('push'),
      new Merge(MAINTAINER),
      new ImmediateRelease(['rk-b']),
    ]);

    expect(world.log).toEqual([]);
    const mergeSha = model.releases[0]?.mergeSha;
    const { builtAt } = world.registry.read();
    expect([builtAt['rk-a@1.0.1'], builtAt['rk-b@1.0.1']]).toEqual([mergeSha, mergeSha]);
    // The immediate release's own commit, on top of the feeder it released.
    const tip = world.mainSha();
    expect([builtAt['rk-a@1.0.2'], builtAt['rk-b@1.0.2']]).toEqual([tip, tip]);
    expect(world.git(world.origin, 'log', '-1', '--format=%s', `${tip}^`)).toMatch(/^fix: immediate change/);
  }, 120_000);

  it("should ignore a release label a writer approved by editing the bot's manifest", async () => {
    world = World.create({ sync: true, enforceMergeAuthor: false });
    current.forge = world.forge;

    await runSequence(world, [new MergeFeeder('fix', ['rk-a']), new Update('push'), new EditManifest()]);

    const manifest = parseManifest(world.forge.manifestWrites.at(-1)?.body ?? '');
    expect(manifest.overrideLabels ?? []).toEqual([]);
    expect(new Set(manifest.versionOutput.updates.map((u) => u.newVersion))).toEqual(new Set(['1.0.1']));
  }, 120_000);

  it('should update the standing PR while a tagged release commit is at the tip of main', async () => {
    world = World.create({ sync: false, enforceMergeAuthor: false });
    current.forge = world.forge;

    const model = await runSequence(world, [
      new MergeFeeder('feat', ['rk-a', 'rk-b']),
      new Update('push'),
      new ToggleSelection(MAINTAINER, 'rk-b'),
      new Merge(MAINTAINER),
      new Publish(null),
      new UpdateAtReleaseTip('schedule'),
      new UpdateAtReleaseTip('labeled'),
    ]);

    expect(model.releaseAtTip).toBe(true);
    expect(model.openPr).toBeDefined();
    expect(world.log).toEqual([]);
  }, 120_000);
});
