import { runPublishStage } from '../registry/dispatcher.js';
import { pubRegistry } from '../registry/pub.js';
import type { PipelineContext } from '../types.js';

/** Error strategy: FAIL-FAST. */
export function runPubPublishStage(ctx: PipelineContext): Promise<void> {
  return runPublishStage(pubRegistry, ctx);
}
