export const LLM_DEFAULTS = {
  timeout: 60_000,
  // 16k tokens accommodates large changelogs without hitting most model ceilings.
  maxTokens: 16_384,
  // 0.7 balances coherence (low temp) with natural-sounding variation (high temp).
  temperature: 0.7,
  concurrency: 5,
  // Max entries per enhance+categorize prompt. Large releases in a single prompt overflow the output
  // ceiling → entry-count validation fails → corrective retries resend a growing transcript. Bounded
  // chunks keep each call within budget and isolate a bad chunk's fallback to that chunk alone.
  enhanceCategorizeChunkSize: 30,
  retry: {
    maxAttempts: 3,
    initialDelay: 1_000,
    maxDelay: 30_000,
    backoffFactor: 2,
  },
  // No default model: releasekit ships no model ids (they rot — e.g. a provider deprecates one), so
  // `llm.model` is required and validated at config load. The model choice, and keeping it current,
  // is the consumer's.
} as const;
