import { cargoRegistry } from '../registry/cargo.js';
import { runPublishStage } from '../registry/dispatcher.js';
import type { PipelineContext } from '../types.js';

/** Publish cargo crates. Error strategy: FAIL-FAST. First publish failure aborts the stage. */
export function runCargoPublishStage(ctx: PipelineContext): Promise<void> {
  return runPublishStage(cargoRegistry, ctx);
}
