export const LLM_DEFAULTS = {
  timeout: 60_000,
  maxTokens: 16_384,
  temperature: 0.7,
  concurrency: 5,
  retry: {
    maxAttempts: 3,
    initialDelay: 1_000,
    maxDelay: 30_000,
    backoffFactor: 2,
  },
  models: {
    openai: 'gpt-4o-mini',
    'openai-compatible': 'gpt-4o-mini',
    anthropic: 'claude-haiku-4-5-20251001',
    ollama: 'llama3.2',
  },
} as const;
