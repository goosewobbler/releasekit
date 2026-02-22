import {
  type LoadOptions,
  loadAuth,
  loadNotesConfig as loadSharedNotesConfig,
  type NotesConfig,
  saveAuth,
} from '@releasekit/config';

export { loadAuth, saveAuth };

export function loadConfig(projectDir: string = process.cwd(), configFile?: string): NotesConfig {
  const options: LoadOptions = { cwd: projectDir, configPath: configFile };
  return loadSharedNotesConfig(options) ?? getDefaultConfig();
}

export function getDefaultConfig(): NotesConfig {
  return {
    output: [{ format: 'markdown', file: 'CHANGELOG.md' }],
    updateStrategy: 'prepend',
  };
}
