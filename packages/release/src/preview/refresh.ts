import { loadCIConfig } from '@releasekit/config';
import { info } from '@releasekit/core';
import { runStandingPRUpdate } from '../standing-pr/standing-pr.js';

export interface RefreshAfterReleaseOptions {
  config?: string;
  projectDir: string;
}

/**
 * A release that bypasses the standing PR leaves its manifest on the old baseline, and the release commit suppresses
 * the push-triggered update, so reconcile it here. A reconcile failure fails the job: a stale standing PR can hold
 * already-published versions. It pushes the release branch, so it needs a workflow-triggering credential - hence a CLI
 * step rather than the orchestrator.
 */
export async function runRefreshAfterRelease(options: RefreshAfterReleaseOptions): Promise<void> {
  const ciConfig = loadCIConfig({ cwd: options.projectDir, configPath: options.config });
  if ((ciConfig?.releaseStrategy ?? 'direct') !== 'standing-pr') {
    info('Nothing to reconcile: there is no standing PR outside the standing-pr release strategy.');
    return;
  }

  info('Reconciling the standing PR after release...');
  await runStandingPRUpdate({
    config: options.config,
    projectDir: options.projectDir,
    reconcile: true,
    verbose: false,
    quiet: false,
    json: false,
  });
}
