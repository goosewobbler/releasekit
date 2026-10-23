import { cargoRegistry } from '../registry/cargo.js';
import { runPublishStage } from '../registry/dispatcher.js';
import type { PipelineContext } from '../types.js';

/** Error strategy: FAIL-FAST. */
export function runCargoPublishStage(ctx: PipelineContext): Promise<void> {
  return runPublishStage(cargoRegistry, ctx);
}
