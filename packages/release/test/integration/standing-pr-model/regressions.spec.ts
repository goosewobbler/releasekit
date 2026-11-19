import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Command, MergeFeeder, PublishOpenPr, Update } from './commands.js';
import type { StatefulForge } from './forge.js';
import { initialModel, refresh } from './model.js';
import { isolateJobEnv, World } from './world.js';

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

async function runSequence(w: World, commands: Command[]) {
  const model = initialModel(w);
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
});
