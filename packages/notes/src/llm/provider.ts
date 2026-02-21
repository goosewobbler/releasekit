import type { CompleteOptions } from '../core/types.js';

export interface LLMProvider {
  readonly name: string;
  complete(prompt: string, options?: CompleteOptions): Promise<string>;
}
