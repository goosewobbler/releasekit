import { BaseVersionError } from './baseError.js';

/**
 * A distinct type so each strategy's changelog try/catch rethrows it instead of degrading to a minimal
 * entry: strictReachable exists to fail loudly on an unreachable baseline (typically a shallow clone),
 * not ship a whole-history changelog on a green run.
 */
export class StrictReachableError extends BaseVersionError {
  constructor(message: string) {
    super(message, 'STRICT_REACHABLE_UNREACHABLE');
  }
}
