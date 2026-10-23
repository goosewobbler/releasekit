import { type LoadOptions, loadAuth, loadConfig as loadSharedConfig, saveAuth } from '@releasekit/config';
import type { Config } from './types.js';

export { loadAuth, saveAuth };

export function loadConfig(projectDir: string = process.cwd(), configFile?: string): Config {
  const options: LoadOptions = { cwd: projectDir, configPath: configFile };
  const fullConfig = loadSharedConfig(options);
  const config: Config = fullConfig.notes ?? getDefaultConfig();
  if (fullConfig.monorepo && !config.monorepo) {
    config.monorepo = fullConfig.monorepo;
  }
  return config;
}

export function getDefaultConfig(): Config {
  return {};
}
