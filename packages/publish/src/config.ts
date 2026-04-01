import { type LoadOptions, loadPublishConfig } from '@releasekit/config';
import { type PublishConfig, toPublishConfig } from './types.js';

export { type LoadOptions, type PublishConfig, toPublishConfig };

export function loadConfig(options?: LoadOptions): PublishConfig {
  const baseConfig = loadPublishConfig(options);
  return toPublishConfig(baseConfig);
}

export function getDefaultConfig(): PublishConfig {
  return toPublishConfig(undefined);
}
