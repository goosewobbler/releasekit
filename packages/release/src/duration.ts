const MULTIPLIERS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDuration(str: string): number | null {
  const match = /^(\d+)(s|m|h|d)$/.exec(str);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  return value * MULTIPLIERS[match[2]];
}

export function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0) parts.push(`${Math.ceil(ms / 1000)}s`);
  return parts.join(' ');
}
