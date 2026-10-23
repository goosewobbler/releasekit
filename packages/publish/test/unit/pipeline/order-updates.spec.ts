import { describe, expect, it } from 'vitest';
import { orderVersionUpdates } from '../../../src/pipeline/order-updates.js';
import type { PublishConfig } from '../../../src/types.js';

const config = {
  npm: { publishOrder: [] },
  cargo: { publishOrder: [] },
} as Pick<PublishConfig, 'npm' | 'cargo'> as PublishConfig;

describe('orderVersionUpdates', () => {
  it('should leave a single update unchanged', () => {
    const updates = [{ packageName: 'a', newVersion: '1.0.0', filePath: 'packages/a/package.json' }];
    expect(orderVersionUpdates(updates, config, '/ws')).toEqual(updates);
  });

  it('should honour npm publishOrder in per-package mode', () => {
    const updates = [
      { packageName: 'app', newVersion: '2.0.0', filePath: 'packages/app/package.json', tag: 'app@v2.0.0' },
      { packageName: 'core', newVersion: '2.0.0', filePath: 'packages/core/package.json', tag: 'core@v2.0.0' },
    ];
    const ordered = orderVersionUpdates(
      updates,
      { ...config, npm: { ...config.npm, publishOrder: ['core', 'app'] } } as PublishConfig,
      '/ws',
    ).map((u) => u.packageName);
    expect(ordered).toEqual(['core', 'app']);
  });
});
