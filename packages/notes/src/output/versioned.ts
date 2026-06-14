import * as fs from 'node:fs';
import * as path from 'node:path';
import { info, success } from '@releasekit/core';
import type { TemplateContext } from '../core/types.js';

/**
 * Write one immutable Markdown file per package version under `directory`.
 *
 * `renderContent` produces each file's body — release-notes content (template, LLM prose, or a clean
 * single-release section), never the cumulative changelog document.
 *
 * Layout: `release-notes/<package>/<version>.md` when `nested`, else `release-notes/<version>.md`.
 * `nested` MUST reflect whether the *repo* has more than one package — not how many packages are in
 * this run. An independently-versioned monorepo releases one package per pipeline invocation, so a
 * flat path would silently overwrite another package that shares a version number — the history loss
 * this mode exists to prevent. Each release writes a *new* file keyed by version; re-running the same
 * release rewrites it idempotently. Standalone so both the live pipeline and the notes-backfill
 * command (#293) share one writer.
 */
export function writeVersionedNotes(
  contexts: TemplateContext[],
  directory: string,
  dryRun: boolean,
  nested: boolean,
  renderContent: (ctx: TemplateContext) => string,
): string[] {
  const written: string[] = [];

  for (const ctx of contexts) {
    const outputPath = nested
      ? path.join(directory, ctx.packageName, `${ctx.version}.md`)
      : path.join(directory, `${ctx.version}.md`);
    const content = renderContent(ctx);

    if (dryRun) {
      info(`[DRY RUN] Release notes (would write to ${outputPath}):`);
      info(content);
      continue;
    }

    // mkdirSync({ recursive: true }) is idempotent — no existsSync guard needed.
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, content, 'utf-8');
    success(`Release notes written to ${outputPath}`);
    written.push(outputPath);
  }

  return written;
}
