import { type LoadOptions, loadConfig as loadReleaseKitConfig } from '@releasekit/config';
import type { Config } from './types.js';
import { toVersionConfig } from './types.js';

export function loadConfig(options?: LoadOptions): Config {
  const fullConfig = loadReleaseKitConfig(options);
  return toVersionConfig(fullConfig.version, fullConfig.git);
}

export type { LoadOptions } from '@releasekit/config';
