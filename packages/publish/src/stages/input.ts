import * as fs from 'node:fs';
import { info, type VersionOutput } from '@releasekit/core';
import { z } from 'zod';
import { createPublishError, PublishErrorCode } from '../errors/index.js';

const VersionChangelogEntrySchema = z.object({
  type: z.string(),
  description: z.string(),
  issueIds: z.array(z.string()).optional(),
  scope: z.string().optional(),
  originalType: z.string().optional(),
});

const VersionPackageChangelogSchema = z.object({
  packageName: z.string(),
  version: z.string(),
  previousVersion: z.string().nullable(),
  revisionRange: z.string(),
  repoUrl: z.string().nullable(),
  entries: z.array(VersionChangelogEntrySchema),
});

const VersionPackageUpdateSchema = z.object({
  packageName: z.string(),
  newVersion: z.string(),
  filePath: z.string(),
});

const VersionOutputSchema = z.object({
  dryRun: z.boolean(),
  updates: z.array(VersionPackageUpdateSchema),
  changelogs: z.array(VersionPackageChangelogSchema),
  commitMessage: z.string().optional(),
  tags: z.array(z.string()),
});

export async function parseInput(inputPath?: string): Promise<VersionOutput> {
  let raw: string;

  if (inputPath) {
    try {
      raw = fs.readFileSync(inputPath, 'utf-8');
    } catch {
      throw createPublishError(PublishErrorCode.INPUT_PARSE_ERROR, `Could not read file: ${inputPath}`);
    }
  } else {
    raw = await readStdin();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw createPublishError(PublishErrorCode.INPUT_PARSE_ERROR, 'Input is not valid JSON');
  }

  const result = VersionOutputSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw createPublishError(PublishErrorCode.INPUT_VALIDATION_ERROR, `Schema validation failed:\n${issues}`);
  }

  if (result.data.updates.length === 0) {
    info('No package updates in version output — pipeline will be a no-op');
  }

  return result.data;
}

async function readStdin(): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return chunks.join('');
}
