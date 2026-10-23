import { runPublishStage } from '../registry/dispatcher.js';
import { npmRegistry, orderNpmUpdates } from '../registry/npm.js';
import type { PipelineContext } from '../types.js';

export { orderNpmUpdates };

/** Error strategy: FAIL-FAST. */
export function runNpmPublishStage(ctx: PipelineContext): Promise<void> {
  return runPublishStage(npmRegistry, ctx);
}
