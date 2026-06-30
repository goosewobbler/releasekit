import { Bumper, type BumperRecommendationResult } from 'conventional-recommended-bump';
import type { ReleaseType } from 'semver';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateVersion } from '../../../src/core/versionCalculator.js';
import * as gitTags from '../../../src/git/tagsAndBranches.js';
import type { Config, VersionOptions } from '../../../src/types.js';
import * as manifestHelpers from '../../../src/utils/manifestHelpers.js';
import * as versionUtils from '../../../src/utils/versionUtils.js';

// Per-package release channel (#485): a package's channel is DERIVED from its current version and
// the default (no explicit channel action) advances it ALONG that channel — a prerelease stays a
// prerelease, a stable stays stable, and a `-next` package never graduates without an explicit
// graduate action. These specs drive the real `calculateVersion` with real semver and a real
// `bumpVersion`; only git tag lookups, manifest reads, and the conventional-commit bumper are stubbed
// so the asserted version strings are the engine's genuine output, not a mock's echo (the older
// versionCalculator.spec automocks `versionUtils`, which empties STANDARD_BUMP_TYPES and neuters this
// exact path — see that file).
vi.mock('../../../src/git/tagsAndBranches.js');
vi.mock('../../../src/utils/manifestHelpers.js');

/** Stub the workspace baseline: the package's current version, surfaced both as the git tag source
 *  and the manifest version, so `getBestVersionSource` (real) resolves to it without touching git. */
function baselineAt(version: string): void {
  vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValue({
    source: 'package',
    version,
    reason: 'test baseline',
  });
  vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
    version,
    manifestFound: true,
    manifestPath: '/repo/packages/pkg/package.json',
    manifestType: 'package.json',
  });
}

/** Stub the conventional-commit recommendation so the inferred magnitude is deterministic. */
function inferredBump(releaseType: ReleaseType): void {
  vi.spyOn(Bumper.prototype, 'loadPreset').mockReturnValue({} as Bumper);
  vi.spyOn(Bumper.prototype, 'commits').mockReturnThis();
  vi.spyOn(Bumper.prototype, 'bump').mockResolvedValue({ releaseType } as unknown as BumperRecommendationResult);
}

const baseConfig: Partial<Config> = { preset: 'angular', versionPrefix: 'v' };
const options = (overrides: Partial<VersionOptions> = {}): VersionOptions => ({
  latestTag: 'v1.0.0-next.1',
  versionPrefix: 'v',
  path: '/repo/packages/pkg',
  name: 'my-pkg',
  ...overrides,
});

beforeEach(() => {
  vi.spyOn(gitTags, 'getCommitsLength').mockResolvedValue(3);
  vi.spyOn(gitTags, 'refExists').mockResolvedValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Per-package release channel — advance along the current line (#485)', () => {
  describe('default (no explicit channel) on a prerelease package', () => {
    it('should advance the prerelease counter for a patch-level change (1.0.0-next.1 -> 1.0.0-next.2)', async () => {
      baselineAt('1.0.0-next.1');
      inferredBump('patch');
      const next = await calculateVersion(baseConfig as Config, options());
      expect(next).toBe('1.0.0-next.2');
    });

    it('should increment the counter for a minor-level change, not escalate the base (1.0.0-next.1 -> 1.0.0-next.2)', async () => {
      // The base is a fixed target until graduation (#500) — a minor doesn't move it to 1.1.0-next.0.
      baselineAt('1.0.0-next.1');
      inferredBump('minor');
      const next = await calculateVersion(baseConfig as Config, options());
      expect(next).toBe('1.0.0-next.2');
    });

    it('should increment the counter for a major-level change, not escalate the base (1.0.0-next.1 -> 1.0.0-next.2)', async () => {
      baselineAt('1.0.0-next.1');
      inferredBump('major');
      const next = await calculateVersion(baseConfig as Config, options());
      expect(next).toBe('1.0.0-next.2');
    });

    it('should increment a higher prerelease counter without resetting it (#500: 1.0.0-next.3 -> 1.0.0-next.4)', async () => {
      baselineAt('1.0.0-next.3');
      inferredBump('minor');
      const next = await calculateVersion(baseConfig as Config, options({ latestTag: 'v1.0.0-next.3' }));
      expect(next).toBe('1.0.0-next.4');
    });

    it('should preserve the existing prerelease identifier rather than the config default', async () => {
      baselineAt('2.3.0-beta.4');
      inferredBump('patch');
      const config = { ...baseConfig, prereleaseIdentifier: 'next' } as Config;
      const next = await calculateVersion(config, options({ latestTag: 'v2.3.0-beta.4' }));
      // The package walks its OWN line (beta), not the configured default (next) — a line switch is
      // a deliberate, out-of-scope action.
      expect(next).toBe('2.3.0-beta.5');
    });

    it('should never graduate a -next package to stable without an explicit graduate action', async () => {
      for (const magnitude of ['patch', 'minor', 'major'] as const) {
        baselineAt('1.0.0-next.1');
        inferredBump(magnitude);
        const next = await calculateVersion(baseConfig as Config, options());
        expect(next).toMatch(/-next\.\d+$/);
      }
    });
  });

  describe('default (no explicit channel) on a stable package', () => {
    it('should bump a stable package normally for a minor change (10.1.0 -> 10.2.0)', async () => {
      baselineAt('10.1.0');
      inferredBump('minor');
      const next = await calculateVersion(baseConfig as Config, options({ latestTag: 'v10.1.0' }));
      expect(next).toBe('10.2.0');
    });

    it('should bump a stable package normally for a patch change (10.1.0 -> 10.1.1)', async () => {
      baselineAt('10.1.0');
      inferredBump('patch');
      const next = await calculateVersion(baseConfig as Config, options({ latestTag: 'v10.1.0' }));
      expect(next).toBe('10.1.1');
    });
  });

  describe('explicit bump magnitude (release:major/minor/patch) without a channel action', () => {
    // A bump LABEL sets the magnitude but not the channel; a prerelease package stays on its line and
    // advances the counter (the bump is not a graduate action, and the base is a fixed target until
    // graduation — #500). To re-target the base of an in-flight prerelease, use channel:prerelease.
    it('should increment the counter under an explicit minor bump, not escalate (1.0.0-next.1 -> 1.0.0-next.2)', async () => {
      baselineAt('1.0.0-next.1');
      const next = await calculateVersion(baseConfig as Config, options({ type: 'minor' }));
      expect(next).toBe('1.0.0-next.2');
    });

    it('should increment the counter under an explicit major bump, not escalate (1.0.0-next.1 -> 1.0.0-next.2)', async () => {
      baselineAt('1.0.0-next.1');
      const next = await calculateVersion(baseConfig as Config, options({ type: 'major' }));
      expect(next).toBe('1.0.0-next.2');
    });

    it('should keep a prerelease on its line under an explicit patch bump (1.0.0-next.1 -> 1.0.0-next.2)', async () => {
      baselineAt('1.0.0-next.1');
      const next = await calculateVersion(baseConfig as Config, options({ type: 'patch' }));
      expect(next).toBe('1.0.0-next.2');
    });
  });

  describe('explicit graduate action (release:graduate / --stable) still graduates', () => {
    it('should graduate a prerelease to stable, dropping the prerelease segment', async () => {
      baselineAt('1.0.0-next.1');
      const config = { ...baseConfig, stableOnly: true } as Config;
      const next = await calculateVersion(config, options());
      expect(next).toBe('1.0.0');
    });
  });

  describe('per-package graduation via graduateScope (#486)', () => {
    it('should graduate a package inside graduateScope to its stable base', async () => {
      baselineAt('1.0.0-next.5');
      // stableOnly + graduateScope covering this package → graduate (bump ignored).
      const config = { ...baseConfig, stableOnly: true, graduateScope: ['my-pkg'] } as Config;
      const next = await calculateVersion(config, options({ name: 'my-pkg' }));
      expect(next).toBe('1.0.0');
    });

    it('should leave a package outside graduateScope on its prerelease line', async () => {
      baselineAt('1.0.0-next.5');
      inferredBump('patch');
      // stableOnly is set, but graduateScope excludes this package → it advances its line, not graduates.
      const config = { ...baseConfig, stableOnly: true, graduateScope: ['other-pkg'] } as Config;
      const next = await calculateVersion(config, options({ name: 'my-pkg' }));
      expect(next).toBe('1.0.0-next.6');
    });

    it('should graduate one package and advance another in a mixed run (some stay prerelease)', async () => {
      const config = { ...baseConfig, stableOnly: true, graduateScope: ['graduating-pkg'] } as Config;

      baselineAt('1.0.0-next.5');
      const graduated = await calculateVersion(config, options({ name: 'graduating-pkg' }));

      baselineAt('2.3.0-next.1');
      inferredBump('minor');
      const staysPre = await calculateVersion(config, options({ name: 'staying-pkg', latestTag: 'v2.3.0-next.1' }));

      expect(graduated).toBe('1.0.0');
      expect(staysPre).toBe('2.3.0-next.2');
    });
  });

  describe('explicit channel:prerelease (isPrerelease) is unchanged by this default', () => {
    it('should create a fresh prerelease from a stable package (10.1.0 + minor -> 10.2.0-next.0)', async () => {
      baselineAt('10.1.0');
      inferredBump('minor');
      const config = { ...baseConfig, isPrerelease: true, prereleaseIdentifier: 'next' } as Config;
      const next = await calculateVersion(config, options({ latestTag: 'v10.1.0' }));
      expect(next).toBe('10.2.0-next.0');
    });
  });

  describe('a mixed standing PR resolves each package on its own channel', () => {
    it('should advance a prerelease and bump a stable package independently in one run', async () => {
      // Prerelease member: stays prerelease.
      baselineAt('1.0.0-next.1');
      inferredBump('minor');
      const pre = await calculateVersion(baseConfig as Config, options({ name: 'pre-pkg' }));

      // Stable member: bumps normally.
      baselineAt('10.1.0');
      inferredBump('minor');
      const stable = await calculateVersion(
        baseConfig as Config,
        options({ name: 'stable-pkg', latestTag: 'v10.1.0' }),
      );

      expect(pre).toBe('1.0.0-next.2');
      expect(stable).toBe('10.2.0');
    });
  });
});
