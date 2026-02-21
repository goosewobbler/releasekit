import * as fs from 'node:fs';
import { cwd } from 'node:process';
import type { Config } from './types.js';

/**
 * Load configuration from version.config.json
 * @param configPath Optional custom path to the config file
 */
export function loadConfig(configPath?: string): Promise<Config> {
  const localProcess = cwd();
  const filePath = configPath || `${localProcess}/version.config.json`;

  return new Promise((resolve, reject) => {
    fs.readFile(filePath, 'utf-8', (err, data) => {
      if (err) {
        reject(new Error(`Could not locate the config file at ${filePath}: ${err.message}`));
        return;
      }

      try {
        const config: Config = JSON.parse(data);
        resolve(config);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        reject(new Error(`Failed to parse config file ${filePath}: ${errorMessage}`));
      }
    });
  });
}
