export function parseDuration(str: string): number | null {
  const match = /^(\d+)(s|m|h|d)$/.exec(str);
  if (!match) return null;
  const digits = match[1];
  const unit = match[2];
  if (!digits || !unit) return null;
  const value = parseInt(digits, 10);
  switch (unit) {
    case 's':
      return value * 1_000;
    case 'm':
      return value * 60_000;
    case 'h':
      return value * 3_600_000;
    case 'd':
      return value * 86_400_000;
    default:
      return null;
  }
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
