export const LLM_DEFAULTS = {
  timeout: 60_000,
  // 16k tokens accommodates large changelogs without hitting most model ceilings.
  maxTokens: 16_384,
  // Balances coherence with natural-sounding variation.
  temperature: 0.7,
  concurrency: 5,
  enhanceCategorizeChunkSize: 30,
  retry: {
    maxAttempts: 3,
    initialDelay: 1_000,
    maxDelay: 30_000,
    backoffFactor: 2,
  },
  // No default model: model ids rot (providers deprecate them), so `llm.model` is required and validated
  // at config load.
} as const;
