import { publishDidChange } from '@releasekit/publish';
import type { ReleaseOutput } from '../types.js';

/**
 * Did a `standing-pr publish` actually publish anything?
 *
 * Not answerable from `versionOutput.updates`: the manifest carries versions the merge already landed
 * on `main`, so it is populated even on a re-run where nothing published. Only `publishOutput` records
 * what this invocation did.
 */
export function releaseDidPublish(result: ReleaseOutput | null | undefined): boolean {
  return publishDidChange(result?.publishOutput);
}
