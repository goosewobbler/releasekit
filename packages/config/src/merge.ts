import type { GitConfig, PublishGitConfig } from './schema.js';

export function mergeGitConfig(topLevel?: GitConfig, packageLevel?: PublishGitConfig): GitConfig | undefined {
  if (!topLevel && !packageLevel) return undefined;

  const base: GitConfig = topLevel ?? {
    remote: 'origin',
    branch: 'main',
    pushMethod: 'auto',
  };

  if (!packageLevel) return base;

  return {
    remote: packageLevel.remote ?? base.remote,
    branch: packageLevel.branch ?? base.branch,
    pushMethod: packageLevel.pushMethod ?? base.pushMethod,
    httpsTokenEnv: packageLevel.httpsTokenEnv ?? base.httpsTokenEnv,
    push: packageLevel.push,
    skipHooks: packageLevel.skipHooks ?? base.skipHooks,
  };
}

export function deepMerge<T extends Record<string, unknown>>(
  target: T | undefined,
  source: Partial<T> | undefined,
): T | undefined {
  if (!target && !source) return undefined;
  if (!target) return source as T;
  if (!source) return target;

  const result = { ...target };

  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (
      sourceValue !== undefined &&
      sourceValue !== null &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue !== undefined &&
      targetValue !== null &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>,
      ) as T[keyof T];
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[keyof T];
    }
  }

  return result;
}
