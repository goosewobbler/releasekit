import { runPublishStage } from '../registry/dispatcher.js';
import { npmRegistry, orderNpmUpdates } from '../registry/npm.js';
import type { PipelineContext } from '../types.js';

export { orderNpmUpdates };

/** Publish npm packages. Error strategy: FAIL-FAST. First publish failure aborts the stage. */
export function runNpmPublishStage(ctx: PipelineContext): Promise<void> {
  return runPublishStage(npmRegistry, ctx);
}
