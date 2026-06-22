import { runPublishStage } from '../registry/dispatcher.js';
import { pubRegistry } from '../registry/pub.js';
import type { PipelineContext } from '../types.js';

/** Publish pub.dev packages. Error strategy: FAIL-FAST. First publish failure aborts the stage. */
export function runPubPublishStage(ctx: PipelineContext): Promise<void> {
  return runPublishStage(pubRegistry, ctx);
}
