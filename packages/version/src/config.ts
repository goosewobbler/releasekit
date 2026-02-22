import { type LoadOptions, loadVersionConfig } from '@releasekit/config';
import type { Config } from './types.js';
import { toVersionConfig } from './types.js';

export function loadConfig(options?: LoadOptions): Config {
  const versionConfig = loadVersionConfig(options);
  return toVersionConfig(versionConfig);
}

export type { LoadOptions } from '@releasekit/config';
