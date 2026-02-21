export const LLM_DEFAULTS = {
  timeout: 60_000,
  maxTokens: 2_000,
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
    anthropic: 'claude-3-5-haiku-latest',
    ollama: 'llama3.2',
  },
} as const;
