import type { TemplateContext } from '../core/types.js';

export function splitByPackage(contexts: TemplateContext[]): Map<string, TemplateContext> {
  const byPackage = new Map<string, TemplateContext>();

  for (const ctx of contexts) {
    byPackage.set(ctx.packageName, ctx);
  }

  return byPackage;
}
