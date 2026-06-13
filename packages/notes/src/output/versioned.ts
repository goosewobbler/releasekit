import * as fs from 'node:fs';
import * as path from 'node:path';
import { info, success } from '@releasekit/core';
import type { TemplateContext } from '../core/types.js';
import { type FormatVersionOptions, renderMarkdown } from './markdown.js';

/**
 * Write one immutable Markdown file per package version under `directory`.
 *
 * Layout: `release-notes/<package>/<version>.md` when `nested`, else `release-notes/<version>.md`.
 * `nested` MUST reflect whether the *repo* has more than one package — not how many packages are in
 * this run. An independently-versioned monorepo releases one package per pipeline invocation, so a
 * flat path would silently overwrite another package that shares a version number (e.g. two packages
 * both at 1.0.0) — the very history loss this mode exists to prevent.
 *
 * Unlike the rolling root/packages outputs, each release writes a *new* file keyed by version, so
 * prior versions are never overwritten; re-running the same release rewrites the same file
 * idempotently. Standalone so both the live pipeline and the notes-backfill command (#293) can
 * write the same per-version history.
 */
export function writeVersionedNotes(
  contexts: TemplateContext[],
  directory: string,
  dryRun: boolean,
  nested: boolean,
  options?: FormatVersionOptions,
): string[] {
  const written: string[] = [];

  for (const ctx of contexts) {
    const outputPath = nested
      ? path.join(directory, ctx.packageName, `${ctx.version}.md`)
      : path.join(directory, `${ctx.version}.md`);
    // Each file is a single package's notes; the path already identifies the package, so the
    // version heading doesn't repeat the name.
    const content = renderMarkdown([ctx], { ...options, includePackageName: false });

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
