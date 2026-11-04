// Separate from the index, so importing core doesn't load zod.
import { z } from 'zod';

export const VersionChangelogEntrySchema = z.looseObject({
  type: z.string(),
  description: z.string(),
  issueIds: z.array(z.string()).optional(),
  prNumber: z.string().optional(),
  scope: z.string().optional(),
  originalType: z.string().optional(),
  breaking: z.boolean().optional(),
});

export const VersionPackageChangelogSchema = z.looseObject({
  packageName: z.string(),
  version: z.string(),
  previousVersion: z.string().nullable(),
  revisionRange: z.string(),
  repoUrl: z.string().nullable(),
  entries: z.array(VersionChangelogEntrySchema),
});

const VersionPackageUpdateSchema = z.looseObject({
  packageName: z.string(),
  newVersion: z.string(),
  filePath: z.string(),
  files: z.array(z.string()).optional(),
  tag: z.string().optional(),
});

/** The `VersionOutput` fields publish relies on; others pass through unchecked. */
export const VersionOutputSchema = z.looseObject({
  dryRun: z.boolean(),
  updates: z.array(VersionPackageUpdateSchema),
  changelogs: z.array(VersionPackageChangelogSchema),
  commitMessage: z.string().optional(),
  tags: z.array(z.string()),
  baselineTags: z.array(z.string()).optional(),
});
