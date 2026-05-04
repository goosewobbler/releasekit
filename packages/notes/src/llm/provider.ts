import type { CompleteOptions } from '../core/types.js';
import type { CompleteResult, LLMMessage } from './messages.js';

export type { CompleteResult, LLMMessage };

export interface ProviderCapabilities {
  systemRole: boolean;
  structuredOutputs: boolean;
  toolUse: boolean;
}

export interface LLMProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  complete(messages: LLMMessage[], options?: CompleteOptions): Promise<CompleteResult>;
}
