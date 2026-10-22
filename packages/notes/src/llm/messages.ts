export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompleteResult {
  content: string;
  structured?: unknown;
}

// Opt-in via RELEASEKIT_DEBUG=1. Output may contain fetched PR bodies and
// example release notes from external repos — don't enable in shared CI logs.
export function debugLogMessages(providerName: string, messages: LLMMessage[]): void {
  if (process.env.RELEASEKIT_DEBUG !== '1') {
    return;
  }
  const lines = [`[RELEASEKIT_DEBUG] ${providerName} messages (${messages.length}):`];
  for (const msg of messages) {
    const preview = msg.content.length > 300 ? `${msg.content.slice(0, 300)}…` : msg.content;
    lines.push(`  [${msg.role}]: ${preview}`);
  }
  // biome-ignore lint/suspicious/noConsole: RELEASEKIT_DEBUG=1 should always print this; the logger would hide it under --quiet
  console.error(lines.join('\n'));
}
