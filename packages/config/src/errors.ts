import { ReleaseKitError } from '@releasekit/core';

export class ConfigError extends ReleaseKitError {
  readonly code = 'CONFIG_ERROR';
  readonly suggestions: string[];

  constructor(message: string, suggestions?: string[]) {
    super(message);
    this.suggestions = suggestions ?? [
      'Check that releasekit.config.json exists and is valid JSON',
      'Run with --verbose for more details',
    ];
  }
}
