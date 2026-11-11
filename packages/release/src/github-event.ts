import * as fs from 'node:fs';

/**
 * This run's GitHub Actions event payload, or undefined outside Actions. An unreadable or malformed file reads as no
 * event unless `strict` is set, when it throws.
 */
export function readGitHubEvent<T>(options: { strict?: boolean } = {}): T | undefined {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(eventPath, 'utf-8')) as T;
  } catch (err) {
    if (options.strict) {
      throw new Error(
        `Failed to read the GitHub event at ${eventPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return undefined;
  }
}
