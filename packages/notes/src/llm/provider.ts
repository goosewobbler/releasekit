import type { CompleteOptions } from '../core/types.js';
import type { CompleteResult, LLMMessage } from './messages.js';

export type { CompleteResult, LLMMessage };

export interface ProviderCapabilities {
  systemRole: boolean;
  structuredOutputs: boolean;
  toolUse: boolean;
  /**
   * Whether the provider actually applies the `temperature` option to its output. Absent = honored
   * (the common case). When `false`, the on-disk cache leaves `temperature` out of the cache key —
   * toggling a parameter the provider ignores must not bust an otherwise-identical cached response.
   * Anthropic sets this `false`: it never forwards `temperature`, and thinking-enabled models reject
   * it with a 400.
   */
  honorsTemperature?: boolean;
}

export interface LLMProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  complete(messages: LLMMessage[], options?: CompleteOptions): Promise<CompleteResult>;
}
