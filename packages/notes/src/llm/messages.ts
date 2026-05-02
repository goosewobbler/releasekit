export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompleteResult {
  content: string;
  structured?: unknown;
}

export function debugLogMessages(providerName: string, messages: LLMMessage[]): void {
  if (process.env.RELEASEKIT_DEBUG !== '1') return;
  console.error(`[RELEASEKIT_DEBUG] ${providerName} messages (${messages.length}):`);
  for (const msg of messages) {
    const preview = msg.content.length > 300 ? `${msg.content.slice(0, 300)}…` : msg.content;
    console.error(`  [${msg.role}]: ${preview}`);
  }
}
