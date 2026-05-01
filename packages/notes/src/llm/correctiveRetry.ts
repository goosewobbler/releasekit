import type { CompleteResult, LLMMessage } from './messages.js';

export type ValidationResult<T> = { valid: true; value: T } | { valid: false; error: string };

/**
 * Attempts a structured-output call, validates the result, and on failure
 * appends the bad output + a correction message and retries.
 *
 * The first call uses `isFirstAttempt = true` so callers can pass structured-
 * output options (schema, toolName) only on the first attempt and fall back
 * to plain-text completion on corrective attempts.
 *
 * maxCorrectiveAttempts = 2 means: 1 initial call + up to 2 corrective calls.
 */
export async function withCorrectiveRetry<T>(
  call: (messages: LLMMessage[], isFirstAttempt: boolean) => Promise<CompleteResult>,
  validate: (result: CompleteResult) => ValidationResult<T>,
  buildCorrectionMessages: (badContent: string, error: string) => LLMMessage[],
  initialMessages: LLMMessage[],
  maxCorrectiveAttempts = 2,
): Promise<T> {
  let messages = initialMessages;
  let lastError = '';

  for (let attempt = 0; attempt <= maxCorrectiveAttempts; attempt++) {
    const result = await call(messages, attempt === 0);
    const validation = validate(result);

    if (validation.valid) return validation.value;

    lastError = validation.error;

    if (attempt < maxCorrectiveAttempts) {
      const badContent = typeof result.structured !== 'undefined' ? JSON.stringify(result.structured) : result.content;
      messages = [
        ...messages,
        { role: 'assistant', content: badContent },
        ...buildCorrectionMessages(badContent, validation.error),
      ];
    }
  }

  throw new Error(`Structured output validation failed after ${maxCorrectiveAttempts + 1} attempts: ${lastError}`);
}
