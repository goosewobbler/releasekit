import { type LoadOptions, loadPublishConfig } from '@releasekit/config';
import { type PublishConfig, toPublishConfig } from './types.js';

export { toPublishConfig, type PublishConfig, type LoadOptions };

export function loadConfig(options?: LoadOptions): PublishConfig {
  const baseConfig = loadPublishConfig(options);
  return toPublishConfig(baseConfig);
}

export function getDefaultConfig(): PublishConfig {
  return toPublishConfig(undefined);
}
