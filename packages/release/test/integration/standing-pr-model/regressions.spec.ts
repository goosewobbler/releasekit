import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseManifest } from '../../../src/standing-pr/standing-pr.js';
import {
  type Command,
  EditManifest,
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

    // The push run publishes from main's tip, above the feeder, but tags the merge.
    await runSequence(world, [new Publish(null)], model);
    expect([...model.publishedBy.keys()].sort()).toEqual(['rk-a@1.0.1', 'rk-b@1.0.1']);
    expect(world.git(world.origin, 'rev-list', '-n', '1', 'v1.0.1')).toBe(model.releases[0]?.mergeSha);
    const next = parseManifest(world.forge.manifestWrites.at(-1)?.body ?? '');
    expect(new Set(next.versionOutput.updates.map((u) => u.newVersion))).toEqual(new Set(['1.0.2']));
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
