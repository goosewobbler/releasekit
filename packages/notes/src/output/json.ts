import * as fs from 'node:fs';
import * as path from 'node:path';
import { info, success } from '@releasekit/core';
import type { TemplateContext } from '../core/types.js';

export function renderJson(contexts: TemplateContext[]): string {
  return JSON.stringify(
    {
      versions: contexts.map((ctx) => ({
        packageName: ctx.packageName,
        version: ctx.version,
        previousVersion: ctx.previousVersion,
        date: ctx.date,
        entries: ctx.entries,
        compareUrl: ctx.compareUrl,
      })),
    },
    null,
    2,
  );
}

export function writeJson(outputPath: string, contexts: TemplateContext[], dryRun: boolean): void {
  const content = renderJson(contexts);

  if (dryRun) {
    info('--- JSON Output Preview ---');
    console.log(content);
    info('--- End Preview ---');
    return;
  }

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, content, 'utf-8');
  success(`JSON output written to ${outputPath}`);
}
