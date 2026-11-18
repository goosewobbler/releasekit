import {
  configuredRefsMode,
  type LoadOptions,
  loadPublishConfig,
  loadConfig as loadReleaseKitConfig,
} from '@releasekit/config';
import { getDefaultConfig, type PublishConfig, toPublishConfig } from './types.js';

export { getDefaultConfig, type LoadOptions, type PublishConfig, toPublishConfig };

export function loadConfig(options?: LoadOptions): PublishConfig {
  return toPublishConfig(loadPublishConfig(options), configuredRefsMode(loadReleaseKitConfig(options).notes));
}
