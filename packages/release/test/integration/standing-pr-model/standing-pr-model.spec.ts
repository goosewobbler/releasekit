import { devNull } from 'node:os';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { commandArbitraries } from './commands.js';
import type { StatefulForge } from './forge.js';
import { initialModel, refresh } from './model.js';
import { World } from './world.js';

const current = vi.hoisted(() => ({ forge: undefined as StatefulForge | undefined }));
vi.mock('../../../src/github.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/github.js')>()),
  forgeFor: () => current.forge,
}));

const RUNS = Number(process.env.RELEASEKIT_MODEL_RUNS ?? 5);
const SEED = process.env.RELEASEKIT_MODEL_SEED;
const PATH = process.env.RELEASEKIT_MODEL_PATH;
const REPLAY = process.env.RELEASEKIT_MODEL_REPLAY;
/** Comma-separated `knownBug` ids to run anyway, such as `#799`. */
const KNOWN_BUGS = new Set((process.env.RELEASEKIT_MODEL_KNOWN_BUGS ?? '').split(',').filter(Boolean));
const BUDGET_MS = Math.max(RUNS, 5) * 60_000;

const ENV = {
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};
const savedEnv = { ...process.env };

beforeAll(() => {
  for (const key of Object.keys(process.env)) {
    if (/^(GITHUB_|ACTIONS_|RUNNER_|GIT_)/.test(key)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, ENV);
});

afterAll(() => {
  process.env = savedEnv;
});

describe('standing-PR lifecycle model', () => {
  it(
    'should keep the release invariants through any sequence of standing-PR events',
    async () => {
      const property = fc.asyncProperty(
        fc.record({ sync: fc.boolean(), enforceMergeAuthor: fc.boolean() }),
        fc.commands(commandArbitraries(KNOWN_BUGS), { maxCommands: 30, size: 'max', replayPath: REPLAY }),
        async (config, commands) => {
          const world = World.create(config);
          current.forge = world.forge;
          try {
            await fc.asyncModelRun(() => {
              const model = initialModel(world);
              refresh(model, world);
              return { model, real: world };
            }, commands);
          } catch (err) {
            const log = world.log.length > 0 ? `\nFailed jobs:\n  ${world.log.join('\n  ')}` : '';
            throw new Error(`${err instanceof Error ? err.message : String(err)}${log}`, { cause: err });
          } finally {
            world.dispose();
          }
        },
      );
      const details = await fc.check(property, {
        numRuns: RUNS,
        seed: SEED === undefined ? undefined : Number(SEED),
        path: PATH,
        interruptAfterTimeLimit: BUDGET_MS,
      });
      let report: string | undefined;
      if (details.failed) {
        const replay = /replayPath="([^"]*)"/.exec(fc.stringify(details.counterexample))?.[1];
        report =
          `${fc.defaultReportMessage(details)}\n\n${details.errorInstance}\n\nReplay with ` +
          `RELEASEKIT_MODEL_RUNS=${RUNS} RELEASEKIT_MODEL_SEED=${details.seed} ` +
          `RELEASEKIT_MODEL_PATH=${details.counterexamplePath} RELEASEKIT_MODEL_REPLAY='${replay}' ` +
          `RELEASEKIT_MODEL_KNOWN_BUGS='${[...KNOWN_BUGS].join(',')}' pnpm --filter @releasekit/release test:integration`;
      }
      expect(report).toBeUndefined();
    },
    BUDGET_MS + 60_000,
  );
});
