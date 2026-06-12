import type { PubspecManifest } from '@releasekit/config';
import { parsePubspec } from '@releasekit/config';
import { debug } from '@releasekit/core';

export type { PubspecManifest };
export { parsePubspec };

export const PUB_DEV_USER_AGENT = 'releasekit/publish (https://github.com/goosewobbler/releasekit)';
export const PUB_DEV_API_TIMEOUT_MS = 30_000;

export function detectPubCommand(environment: Record<string, unknown> | undefined): 'dart' | 'flutter' {
  return environment && 'flutter' in environment ? 'flutter' : 'dart';
}

export async function isPubPackagePublished(name: string, version: string): Promise<boolean> {
  try {
    const response = await fetch(`https://pub.dev/api/packages/${name}/versions/${version}`, {
      signal: AbortSignal.timeout(PUB_DEV_API_TIMEOUT_MS),
      headers: { 'User-Agent': PUB_DEV_USER_AGENT },
    });
    if (response.status === 200) return true;
    if (response.status === 404) return false;
    debug(`pub.dev published-check returned ${response.status} for ${name}@${version}, will attempt publish`);
    return false;
  } catch (error) {
    debug(
      `pub.dev published-check failed for ${name}@${version} (${error instanceof Error ? error.message : String(error)}), will attempt publish`,
    );
    return false;
  }
}
